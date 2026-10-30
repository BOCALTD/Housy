/**
 * Offline field work (master prompt §49). An inspector downloads the inspections assigned to them, records them on the device
 * without a connection, and sends them when back online. Sending is safe to repeat (each send carries the device's own id),
 * every send is checked against the inspector's permissions at that moment, and changes the office made meanwhile are merged
 * field by field (field-merge.ts) rather than overwritten. Nothing that needs a live check (payments, verification, live
 * location) is offered offline.
 */
import { z } from "zod";
import { withTenant, type Tx } from "../db";
import { logActivity } from "../audit";
import { parseDateOnly, todayInLagos, toDateOnlyString } from "../dates";
import { can } from "../permissions";
import { CLIENT_ID, mergeRecord, type Conflict, type FieldRecord } from "../field-merge";
import { CHECK_RESULTS, RATINGS, SEVERITIES, assertCanRecord, findingSchema, lockInspection, submitInspection } from "./inspections";
import { savePhoto, type Upload } from "./photos";
import { assertCan, type Ctx } from "./context";

export const PACK_LIMIT = 25;
const PACK_BACK_DAYS = 60, PACK_AHEAD_DAYS = 14;

type Row = { conductedOn: Date | null; conditionRating: string | null; summary: string; recommendedActions: string; location: string; participants: string; technicalNotes: string; responses: { id: string; result: string; note: string }[] };
export function recordOf(r: Row): FieldRecord {
  return {
    conductedOn: r.conductedOn ? toDateOnlyString(r.conductedOn) : "", conditionRating: r.conditionRating ?? "", summary: r.summary,
    recommendedActions: r.recommendedActions, location: r.location, participants: r.participants, technicalNotes: r.technicalNotes,
    responses: Object.fromEntries(r.responses.map((x) => [x.id, { result: x.result, note: x.note }])),
  };
}

/** The inspector's open inspections from the last 60 days and the next 14, with everything needed to record them offline. */
export async function fieldPack(ctx: Ctx & { userName?: string; companyName?: string }) {
  assertCan(ctx, "inspection.conduct");
  const today = todayInLagos();
  const rows = await withTenant(ctx.companyId, ctx.userId, (tx) => tx.inspection.findMany({
    where: {
      companyId: ctx.companyId, status: "SCHEDULED", inspectorId: ctx.membershipId,
      scheduledFor: { gte: new Date(today.getTime() - PACK_BACK_DAYS * 864e5), lte: new Date(today.getTime() + PACK_AHEAD_DAYS * 864e5) },
    },
    orderBy: [{ scheduledFor: "asc" }, { ref: "asc" }], take: PACK_LIMIT,
    include: { asset: { select: { name: true, address: true, city: true, state: true } }, responses: { orderBy: { sortOrder: "asc" } } },
  }));
  return {
    userId: ctx.userId, userName: ctx.userName ?? "", companyId: ctx.companyId, companyName: ctx.companyName ?? "", packedAt: new Date().toISOString(),
    inspections: rows.map((r) => ({
      id: r.id, ref: r.ref, purpose: r.purpose, scheduledFor: toDateOnlyString(r.scheduledFor), revision: r.revision,
      asset: { name: r.asset.name, address: [r.asset.address, r.asset.city, r.asset.state].filter(Boolean).join(", ") },
      items: r.responses.map((x) => ({ id: x.id, category: x.category, prompt: x.prompt })),
      record: recordOf(r),
    })),
  };
}

const text = (max: number) => z.string().max(max).default("");
const recordSchema = z.object({
  conductedOn: z.string().max(10).default(""), conditionRating: z.string().max(20).default(""), summary: text(5000), recommendedActions: text(5000),
  location: text(300), participants: text(500), technicalNotes: text(3000),
  responses: z.record(z.string().max(60), z.object({ result: z.enum(CHECK_RESULTS), note: text(1000) })).refine((r) => Object.keys(r).length <= 300, "Too many checklist items"),
});
const syncSchema = z.object({
  clientId: z.string().regex(CLIENT_ID, "A send needs the device's id"),
  inspectionId: z.string().uuid(),
  base: recordSchema, mine: recordSchema,
  findings: z.array(findingSchema.extend({ clientId: z.string().regex(CLIENT_ID) })).max(30).default([]),
});

export type SyncResult =
  | { outcome: "applied" | "conflicts"; revision: number; applied: number; conflicts: Conflict[]; record: FieldRecord; findings: Record<string, string> }
  | { outcome: "closed"; status: string };

async function already(tx: Tx, ctx: Ctx, clientId: string) {
  const row = await tx.fieldSync.findUnique({ where: { companyId_userId_clientId: { companyId: ctx.companyId, userId: ctx.userId, clientId } } });
  return row ? (row.result as unknown) : null;
}

/** Apply a record made offline. Repeating the same send returns the first answer and changes nothing. */
export async function syncFieldRecord(ctx: Ctx, input: unknown): Promise<SyncResult> {
  const data = syncSchema.parse(input);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const seen = await already(tx, ctx, data.clientId);
    if (seen) return seen as SyncResult;
    await lockInspection(tx, data.inspectionId, ctx.companyId);
    const row = await tx.inspection.findUniqueOrThrow({ where: { id: data.inspectionId }, include: { responses: { orderBy: { sortOrder: "asc" } } } });
    assertCanRecord(ctx, row.inspectorId); // checked now, not when the inspection was downloaded

    let result: SyncResult;
    if (row.status !== "SCHEDULED") {
      result = { outcome: "closed", status: row.status };
    } else {
      const office = recordOf(row);
      const labels = Object.fromEntries(row.responses.map((x) => [x.id, x.prompt]));
      const { merged, conflicts, applied } = mergeRecord(data.base as FieldRecord, data.mine as FieldRecord, office, labels);
      if (merged.conditionRating && !(RATINGS as readonly string[]).includes(merged.conditionRating)) throw new Error("Choose a valid condition rating");
      let conducted: Date | null = null;
      if (merged.conductedOn) {
        conducted = parseDateOnly(merged.conductedOn);
        if (conducted > todayInLagos()) throw new Error("The inspection date cannot be in the future");
      }
      let revision = row.revision;
      if (applied > 0) {
        for (const x of row.responses) {
          const m = merged.responses[x.id];
          if (m && (m.result !== x.result || m.note !== x.note)) await tx.inspectionResponse.update({ where: { id: x.id }, data: { result: m.result as never, note: m.note.slice(0, 1000) } });
        }
        const up = await tx.inspection.update({
          where: { id: row.id },
          data: {
            conductedOn: conducted, conditionRating: (merged.conditionRating || null) as never, summary: merged.summary.trim(), recommendedActions: merged.recommendedActions.trim(),
            location: merged.location.trim(), participants: merged.participants.trim(), technicalNotes: merged.technicalNotes.trim(), revision: { increment: 1 },
          },
        });
        revision = up.revision;
      }
      const findings: Record<string, string> = {};
      for (const f of data.findings) {
        const created = await tx.inspectionFinding.create({
          data: {
            companyId: ctx.companyId, inspectionId: row.id, title: f.title, description: f.description, location: f.location, severity: f.severity,
            safetyRisk: f.safetyRisk, estimatedCostKobo: f.estimatedCost, recommendedAction: f.recommendedAction, createdById: ctx.userId,
          },
        });
        findings[f.clientId] = created.id;
      }
      result = { outcome: conflicts.length ? "conflicts" : "applied", revision, applied, conflicts, record: recordOf({ ...row, ...merged, conductedOn: conducted, conditionRating: merged.conditionRating || null, responses: row.responses.map((x) => ({ id: x.id, ...(merged.responses[x.id] ?? x) })) }), findings };
      await logActivity(tx, {
        companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: row.assetId, action: "inspection.synced_from_device",
        detail: { inspectionId: row.id, ref: row.ref, applied, conflicts: conflicts.map((c) => c.key), findings: data.findings.length },
      });
    }
    await tx.fieldSync.create({ data: { companyId: ctx.companyId, userId: ctx.userId, clientId: data.clientId, kind: "record", subjectId: data.inspectionId, result: result as never } });
    return result;
  });
}

const photoSchema = z.object({
  clientId: z.string().regex(CLIENT_ID), inspectionId: z.string().uuid(), findingId: z.string().uuid().nullable(),
  caption: z.string().trim().max(200).default(""),
});

/** A photograph taken offline. Sent once per device id; the inspection must still be open and the inspector still allowed. */
export async function syncFieldPhoto(ctx: Ctx, meta: z.input<typeof photoSchema>, file: Upload) {
  const m = photoSchema.parse(meta);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const seen = await already(tx, ctx, m.clientId);
    if (seen) return seen as { outcome: "saved" | "closed"; photoId?: string };
    await lockInspection(tx, m.inspectionId, ctx.companyId);
    const row = await tx.inspection.findUniqueOrThrow({ where: { id: m.inspectionId } });
    assertCanRecord(ctx, row.inspectorId);
    let result: { outcome: "saved" | "closed"; photoId?: string };
    if (row.status !== "SCHEDULED") result = { outcome: "closed" };
    else {
      if (m.findingId && !(await tx.inspectionFinding.findFirst({ where: { id: m.findingId, inspectionId: row.id, companyId: ctx.companyId }, select: { id: true } }))) throw new Error("Finding not found");
      const p = await savePhoto(tx, ctx, m.findingId ? "inspection_finding" : "inspection", m.findingId ?? row.id, { phase: "EVIDENCE", caption: m.caption || "Photo taken on site" } as never, file);
      result = { outcome: "saved", photoId: p.id };
    }
    await tx.fieldSync.create({ data: { companyId: ctx.companyId, userId: ctx.userId, clientId: m.clientId, kind: "photo", subjectId: m.inspectionId, result } });
    return result;
  });
}

/** Submit for approval once everything is sent; the usual checks apply (every item answered, a rating and a summary). */
export async function submitFromDevice(ctx: Ctx, inspectionId: string) {
  const id = z.string().uuid().parse(inspectionId);
  const row = await withTenant(ctx.companyId, ctx.userId, (tx) => tx.inspection.findFirst({ where: { id, companyId: ctx.companyId }, select: { status: true } }));
  if (!row) throw new Error("Inspection not found");
  if (row.status === "SUBMITTED" || row.status === "APPROVED") return { outcome: "already" as const };
  await submitInspection(ctx, id);
  return { outcome: "submitted" as const };
}

export { SEVERITIES };
export const canUseFieldKit = (role: Ctx["role"]) => can(role, "inspection.conduct");
