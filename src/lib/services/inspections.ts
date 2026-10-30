import { z } from "zod";
import { withTenant, type Tx } from "../db";
import { logActivity } from "../audit";
import { parseNairaToKobo } from "../money";
import { addMonthsClamped, parseDateOnly, todayInLagos } from "../dates";
import { nextNumber } from "../numbering";
import { inspectionWarnings, parseChecklist, STARTER_TEMPLATES, submissionProblem, conditionChange, type Rating } from "../inspection-rules";
import { can } from "../permissions";
import { savePhoto, photosFor, type Upload } from "./photos";
import { assertCan, type Ctx } from "./context";

// Inspections: templates, scheduling, checklist and findings, photographs, review and approval
// (master prompt Section 14). Software organises the record; it does not replace a professional inspection.

export const PURPOSES = ["ROUTINE", "PRE_LEASE", "MOVE_IN", "MOVE_OUT", "VALUATION", "MAINTENANCE_ASSESSMENT", "CONSTRUCTION", "CONDITION_SURVEY"] as const;
export const RATINGS = ["EXCELLENT", "GOOD", "FAIR", "POOR", "CRITICAL"] as const;
export const CHECK_RESULTS = ["PENDING", "PASS", "ATTENTION", "FAIL", "NOT_APPLICABLE"] as const;
export const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const ASSET_CLASSES = ["RESIDENTIAL", "COMMERCIAL", "LAND", "INDUSTRIAL", "PLANT_MACHINERY", "OTHER"] as const;

export async function lockInspection(tx: Tx, id: string, companyId: string) {
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM inspections WHERE id = $1 AND company_id = $2 FOR UPDATE`, id, companyId);
  if (rows.length === 0) throw new Error("Inspection not found");
}

// ---------- Templates ----------

export async function installStarterTemplates(ctx: Ctx) {
  assertCan(ctx, "inspection.manage");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const existing = new Set((await tx.inspectionTemplate.findMany({ where: { companyId: ctx.companyId }, select: { name: true } })).map((t) => t.name));
    let added = 0;
    for (const t of STARTER_TEMPLATES) {
      if (existing.has(t.name)) continue;
      const row = await tx.inspectionTemplate.create({ data: { companyId: ctx.companyId, name: t.name, assetClass: t.assetClass, createdById: ctx.userId } });
      await tx.inspectionTemplateItem.createMany({
        data: t.items.map((it, i) => ({ companyId: ctx.companyId, templateId: row.id, category: it.category, prompt: it.prompt, sortOrder: i + 1 })),
      });
      added += 1;
    }
    if (added > 0) {
      await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "company", entityId: ctx.companyId, action: "inspection.templates_installed", detail: { added } });
    }
    return added;
  });
}

const templateSchema = z.object({
  name: z.string().trim().min(3, "Name the template").max(120),
  assetClass: z.string().optional().transform((v, ctx): (typeof ASSET_CLASSES)[number] | null => {
    if (!v) return null;
    if (!(ASSET_CLASSES as readonly string[]).includes(v)) { ctx.addIssue({ code: "custom", message: "Choose a valid asset class" }); return z.NEVER; }
    return v as (typeof ASSET_CLASSES)[number];
  }),
  checklist: z.string().transform((v, ctx) => {
    try { return parseChecklist(v); } catch (e) { ctx.addIssue({ code: "custom", message: e instanceof Error ? e.message : "Check the checklist" }); return z.NEVER; }
  }),
});

export async function createTemplate(ctx: Ctx, input: z.input<typeof templateSchema>) {
  assertCan(ctx, "inspection.manage");
  const data = templateSchema.parse(input);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const dup = await tx.inspectionTemplate.findFirst({ where: { companyId: ctx.companyId, name: data.name }, select: { id: true } });
    if (dup) throw new Error("A template with that name already exists");
    const row = await tx.inspectionTemplate.create({ data: { companyId: ctx.companyId, name: data.name, assetClass: data.assetClass, createdById: ctx.userId } });
    await tx.inspectionTemplateItem.createMany({
      data: data.checklist.map((it, i) => ({ companyId: ctx.companyId, templateId: row.id, category: it.category, prompt: it.prompt, sortOrder: i + 1 })),
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "company", entityId: ctx.companyId, action: "inspection.template_created", detail: { templateId: row.id, name: data.name, items: data.checklist.length } });
    return row;
  });
}

export async function setTemplateActive(ctx: Ctx, templateId: string, active: boolean) {
  assertCan(ctx, "inspection.manage");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const t = await tx.inspectionTemplate.findFirst({ where: { id: templateId, companyId: ctx.companyId } });
    if (!t) throw new Error("Template not found");
    await tx.inspectionTemplate.update({ where: { id: templateId }, data: { active } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "company", entityId: ctx.companyId, action: active ? "inspection.template_activated" : "inspection.template_deactivated", detail: { templateId } });
  });
}

// ---------- Scheduling ----------

const scheduleSchema = z.object({
  templateId: z.string().optional().transform((v) => v || null),
  leaseId: z.string().optional().transform((v) => v || null),
  purpose: z.enum(PURPOSES),
  scheduledFor: z.string().transform((v) => parseDateOnly(v)),
  inspectorId: z.string().optional().transform((v) => v || null),
  responsibleId: z.string().optional().transform((v) => v || null),
  location: z.string().trim().max(300).default(""),
  participants: z.string().trim().max(500).default(""),
  recurrenceMonths: z.string().trim().optional().transform((v, ctx): number | null => {
    if (!v) return null;
    if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 120) {
      ctx.addIssue({ code: "custom", message: "Repeat every a whole number of months between 1 and 120, or leave blank" });
      return z.NEVER;
    }
    return Number(v);
  }),
});

type ScheduleData = z.output<typeof scheduleSchema>;

async function activeMember(tx: Tx, companyId: string, membershipId: string | null, label: string) {
  if (!membershipId) return;
  const m = await tx.membership.findFirst({ where: { id: membershipId, companyId, status: "ACTIVE" }, select: { id: true } });
  if (!m) throw new Error(`Choose an active member of your company as the ${label}`);
}

async function insertInspection(tx: Tx, ctx: Ctx, assetId: string, data: ScheduleData, rolledFromId: string | null) {
  const asset = await tx.asset.findFirst({ where: { id: assetId, companyId: ctx.companyId }, select: { id: true } });
  if (!asset) throw new Error("Asset not found");
  await activeMember(tx, ctx.companyId, data.inspectorId, "inspector");
  await activeMember(tx, ctx.companyId, data.responsibleId, "responsible officer");
  if (data.leaseId) {
    const lease = await tx.lease.findFirst({ where: { id: data.leaseId, companyId: ctx.companyId, assetId }, select: { id: true } });
    if (!lease) throw new Error("That lease does not belong to this asset");
  }
  let items: { category: string; prompt: string }[] = [];
  if (data.templateId) {
    const t = await tx.inspectionTemplate.findFirst({ where: { id: data.templateId, companyId: ctx.companyId }, include: { items: { orderBy: { sortOrder: "asc" } } } });
    if (!t) throw new Error("Template not found");
    if (!t.active && !rolledFromId) throw new Error("That template is switched off");
    items = t.items;
  }
  const year = data.scheduledFor.getUTCFullYear();
  const n = await nextNumber(tx, ctx.companyId, "INS", year);
  const ref = `INS-${year}-${String(n).padStart(4, "0")}`;
  const row = await tx.inspection.create({
    data: {
      companyId: ctx.companyId, assetId, templateId: data.templateId, leaseId: data.leaseId, ref, purpose: data.purpose,
      scheduledFor: data.scheduledFor, location: data.location, inspectorId: data.inspectorId, responsibleId: data.responsibleId,
      participants: data.participants, recurrenceMonths: data.recurrenceMonths, rolledFromId, createdById: ctx.userId,
    },
  });
  if (items.length > 0) {
    await tx.inspectionResponse.createMany({
      data: items.map((it, i) => ({ companyId: ctx.companyId, inspectionId: row.id, category: it.category, prompt: it.prompt, sortOrder: i + 1 })),
    });
  }
  await logActivity(tx, {
    companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: assetId, action: "inspection.scheduled",
    detail: { inspectionId: row.id, ref, purpose: data.purpose, scheduledFor: data.scheduledFor.toISOString().slice(0, 10), items: items.length },
  });
  return row;
}

export async function scheduleInspection(ctx: Ctx, assetId: string, input: z.input<typeof scheduleSchema>) {
  assertCan(ctx, "inspection.manage");
  const data = scheduleSchema.parse(input);
  return withTenant(ctx.companyId, ctx.userId, (tx) => insertInspection(tx, ctx, assetId, data, null));
}

export async function cancelInspection(ctx: Ctx, inspectionId: string, reasonInput: string) {
  assertCan(ctx, "inspection.manage");
  const reason = z.string().trim().min(5, "Give the reason for cancelling this inspection").max(500).parse(reasonInput);
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await lockInspection(tx, inspectionId, ctx.companyId);
    const row = await tx.inspection.findUniqueOrThrow({ where: { id: inspectionId } });
    if (row.status !== "SCHEDULED") throw new Error("Only a scheduled inspection can be cancelled");
    await tx.inspection.update({ where: { id: inspectionId }, data: { status: "CANCELLED", cancelReason: reason } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: row.assetId, action: "inspection.cancelled", detail: { inspectionId, reason } });
  });
}

// ---------- Recording ----------

/** The assigned inspector, or a manager, may record the inspection. Others may not. */
export function assertCanRecord(ctx: Ctx, inspectorId: string | null) {
  assertCan(ctx, "inspection.conduct");
  if (inspectorId !== ctx.membershipId && !can(ctx.role, "inspection.manage")) {
    throw new Error("Only the assigned inspector or a manager can record this inspection");
  }
}

const recordSchema = z.object({
  conductedOn: z.string().trim().optional().transform((v) => (v ? parseDateOnly(v) : null)),
  location: z.string().trim().max(300).default(""),
  participants: z.string().trim().max(500).default(""),
  conditionRating: z.string().optional().transform((v, ctx): Rating | null => {
    if (!v) return null;
    if (!(RATINGS as readonly string[]).includes(v)) { ctx.addIssue({ code: "custom", message: "Choose a valid condition rating" }); return z.NEVER; }
    return v as Rating;
  }),
  summary: z.string().trim().max(5000).default(""),
  recommendedActions: z.string().trim().max(5000).default(""),
  estimatedRepair: z.string().trim().optional().transform((v) => (v ? parseNairaToKobo(v) : null)),
  followUpBy: z.string().trim().optional().transform((v) => (v ? parseDateOnly(v) : null)),
  operatingHours: z.string().trim().optional().transform((v, ctx): number | null => {
    if (!v) return null;
    if (!/^\d{1,9}$/.test(v)) { ctx.addIssue({ code: "custom", message: "Operating hours must be a whole number" }); return z.NEVER; }
    return Number(v);
  }),
  technicalNotes: z.string().trim().max(3000).default(""),
  responses: z.record(z.string(), z.object({
    result: z.enum(CHECK_RESULTS),
    note: z.string().trim().max(1000).default(""),
  })).default({}),
});

/** Save the inspector's answers and details. Can be saved as often as needed until the inspection is submitted. */
export async function saveInspectionRecord(ctx: Ctx, inspectionId: string, input: z.input<typeof recordSchema>) {
  const data = recordSchema.parse(input);
  const today = todayInLagos();
  if (data.conductedOn && data.conductedOn > today) throw new Error("The inspection date cannot be in the future");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await lockInspection(tx, inspectionId, ctx.companyId);
    const row = await tx.inspection.findUniqueOrThrow({ where: { id: inspectionId }, include: { responses: true } });
    assertCanRecord(ctx, row.inspectorId);
    if (row.status !== "SCHEDULED") throw new Error("This inspection has been submitted or closed and can no longer be edited");
    const ids = new Set(row.responses.map((r) => r.id));
    for (const id of Object.keys(data.responses)) if (!ids.has(id)) throw new Error("That checklist item does not belong to this inspection");
    for (const [id, r] of Object.entries(data.responses)) {
      await tx.inspectionResponse.update({ where: { id }, data: { result: r.result, note: r.note } });
    }
    await tx.inspection.update({
      where: { id: inspectionId },
      data: {
        conductedOn: data.conductedOn, location: data.location, participants: data.participants, conditionRating: data.conditionRating,
        summary: data.summary, recommendedActions: data.recommendedActions, estimatedRepairKobo: data.estimatedRepair,
        followUpBy: data.followUpBy, operatingHours: data.operatingHours, technicalNotes: data.technicalNotes,
        revision: { increment: 1 },
      },
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: row.assetId, action: "inspection.recorded", detail: { inspectionId, ref: row.ref } });
  });
}

export const findingSchema = z.object({
  title: z.string().trim().min(3, "Name the defect or observation").max(200),
  description: z.string().trim().max(3000).default(""),
  location: z.string().trim().max(200).default(""),
  severity: z.enum(SEVERITIES),
  safetyRisk: z.boolean().default(false),
  estimatedCost: z.string().trim().optional().transform((v) => (v ? parseNairaToKobo(v) : null)),
  recommendedAction: z.string().trim().max(2000).default(""),
});

export async function addFinding(ctx: Ctx, inspectionId: string, input: z.input<typeof findingSchema>, photo: (Upload & { phase?: string; caption?: string }) | null = null) {
  const data = findingSchema.parse(input);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await lockInspection(tx, inspectionId, ctx.companyId);
    const row = await tx.inspection.findUniqueOrThrow({ where: { id: inspectionId } });
    assertCanRecord(ctx, row.inspectorId);
    if (row.status !== "SCHEDULED") throw new Error("This inspection has been submitted or closed and can no longer be edited");
    const finding = await tx.inspectionFinding.create({
      data: {
        companyId: ctx.companyId, inspectionId, title: data.title, description: data.description, location: data.location,
        severity: data.severity, safetyRisk: data.safetyRisk, estimatedCostKobo: data.estimatedCost,
        recommendedAction: data.recommendedAction, createdById: ctx.userId,
      },
    });
    if (photo) await savePhoto(tx, ctx, "inspection_finding", finding.id, { phase: (photo.phase as never) ?? "EVIDENCE", caption: photo.caption ?? data.title }, photo);
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: row.assetId, action: "inspection.finding_added",
      detail: { inspectionId, findingId: finding.id, title: data.title, severity: data.severity, safetyRisk: data.safetyRisk },
    });
    return finding;
  });
}

/** Add a photograph to an inspection or one of its findings while the inspection is still open. */
export async function addInspectionPhoto(ctx: Ctx, inspectionId: string, findingId: string | null, meta: { phase?: string; caption?: string }, file: Upload) {
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await lockInspection(tx, inspectionId, ctx.companyId);
    const row = await tx.inspection.findUniqueOrThrow({ where: { id: inspectionId } });
    assertCanRecord(ctx, row.inspectorId);
    if (row.status !== "SCHEDULED") throw new Error("This inspection has been submitted or closed and can no longer be edited");
    if (findingId) {
      const f = await tx.inspectionFinding.findFirst({ where: { id: findingId, inspectionId, companyId: ctx.companyId }, select: { id: true } });
      if (!f) throw new Error("Finding not found");
    }
    return savePhoto(tx, ctx, findingId ? "inspection_finding" : "inspection", findingId ?? inspectionId, meta as never, file);
  });
}

// ---------- Review ----------

export async function submitInspection(ctx: Ctx, inspectionId: string) {
  const today = todayInLagos();
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await lockInspection(tx, inspectionId, ctx.companyId);
    const row = await tx.inspection.findUniqueOrThrow({ where: { id: inspectionId }, include: { responses: true } });
    assertCanRecord(ctx, row.inspectorId);
    if (row.status !== "SCHEDULED") throw new Error("This inspection has already been submitted or closed");
    const problem = submissionProblem({
      conductedOn: row.conductedOn, today, rating: row.conditionRating, summary: row.summary, responses: row.responses,
    });
    if (problem) throw new Error(problem);
    await tx.inspection.update({
      where: { id: inspectionId },
      data: { status: "SUBMITTED", submittedById: ctx.userId, submittedAt: new Date(), returnNote: "" },
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: row.assetId, action: "inspection.submitted", detail: { inspectionId, ref: row.ref } });
  });
}

/**
 * Approve a submitted inspection or return it for correction. Approval needs someone who is neither the
 * assigned inspector nor the person who submitted it. A recurring inspection schedules the next one.
 */
export async function decideInspection(ctx: Ctx, inspectionId: string, decision: "approve" | "return", noteInput: string) {
  assertCan(ctx, "inspection.approve");
  const note = z.string().trim().max(1000).parse(noteInput);
  if (decision === "return" && note.length < 5) throw new Error("Say what needs correcting");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await lockInspection(tx, inspectionId, ctx.companyId);
    const row = await tx.inspection.findUniqueOrThrow({ where: { id: inspectionId }, include: { inspector: { select: { userId: true } } } });
    if (row.status !== "SUBMITTED") throw new Error("Only a submitted inspection can be approved or returned");
    if (row.submittedById === ctx.userId || row.inspector?.userId === ctx.userId) {
      throw new Error("An inspection must be approved by someone other than the inspector or the person who submitted it");
    }
    if (decision === "return") {
      await tx.inspection.update({ where: { id: inspectionId }, data: { status: "SCHEDULED", returnNote: note, decidedById: ctx.userId, decidedAt: new Date() } });
      await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: row.assetId, action: "inspection.returned", detail: { inspectionId, note } });
      return null;
    }
    await tx.inspection.update({ where: { id: inspectionId }, data: { status: "APPROVED", decidedById: ctx.userId, decidedAt: new Date(), returnNote: "" } });
    let next: { id: string; ref: string } | null = null;
    if (row.recurrenceMonths && row.conductedOn) {
      next = await insertInspection(tx, ctx, row.assetId, {
        templateId: row.templateId, leaseId: null, purpose: row.purpose, scheduledFor: addMonthsClamped(row.conductedOn, row.recurrenceMonths),
        inspectorId: row.inspectorId, responsibleId: row.responsibleId, location: row.location, participants: row.participants,
        recurrenceMonths: row.recurrenceMonths,
      }, row.id);
    }
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: row.assetId, action: "inspection.approved", detail: { inspectionId, ref: row.ref, next: next?.ref ?? null } });
    return next;
  });
}

// ---------- Reading ----------

export async function listInspections(ctx: Ctx) {
  assertCan(ctx, "asset.view");
  const today = todayInLagos();
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const include = { asset: { select: { id: true, ref: true, name: true } } } as const;
    const [open, recent, templates, assets, members] = await Promise.all([
      tx.inspection.findMany({ where: { companyId: ctx.companyId, status: { in: ["SCHEDULED", "SUBMITTED"] } }, orderBy: { scheduledFor: "asc" }, include }),
      tx.inspection.findMany({ where: { companyId: ctx.companyId, status: { in: ["APPROVED", "CANCELLED"] } }, orderBy: { createdAt: "desc" }, take: 20, include }),
      tx.inspectionTemplate.findMany({ where: { companyId: ctx.companyId }, orderBy: { name: "asc" }, include: { _count: { select: { items: true } } } }),
      tx.asset.findMany({ where: { companyId: ctx.companyId }, select: { id: true, ref: true, name: true }, orderBy: { ref: "asc" } }),
      tx.membership.findMany({ where: { companyId: ctx.companyId, status: "ACTIVE" }, include: { user: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
    ]);
    const names = Object.fromEntries(members.map((m) => [m.id, m.user.name]));
    return {
      today,
      overdue: open.filter((i) => i.status === "SCHEDULED" && i.scheduledFor < today),
      scheduled: open.filter((i) => i.status === "SCHEDULED" && i.scheduledFor >= today),
      awaiting: open.filter((i) => i.status === "SUBMITTED"),
      recent, templates, assets, names,
      members: members.map((m) => ({ id: m.id, name: m.user.name, role: m.role })),
    };
  });
}

export async function getInspection(ctx: Ctx, inspectionId: string) {
  assertCan(ctx, "asset.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const row = await tx.inspection.findFirst({
      where: { id: inspectionId, companyId: ctx.companyId },
      include: {
        asset: { select: { id: true, ref: true, name: true, assetClass: true } },
        template: { select: { name: true } },
        responses: { orderBy: { sortOrder: "asc" } },
        findings: { orderBy: { createdAt: "asc" } },
        rolledTo: { select: { id: true, ref: true } },
        rolledFrom: { select: { id: true, ref: true } },
        inspector: { select: { userId: true, user: { select: { name: true } } } },
      },
    });
    if (!row) return null;
    const photos = [
      ...(await photosFor(tx, ctx.companyId, "inspection", [row.id])),
      ...(await photosFor(tx, ctx.companyId, "inspection_finding", row.findings.map((f) => f.id))),
    ];
    const userIds = [row.createdById, row.submittedById, row.decidedById, ...photos.map((p) => p.uploadedById)].filter((x): x is string => !!x);
    const users = await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
    const history = await tx.activityLog.findMany({
      where: { companyId: ctx.companyId, OR: [{ entityId: row.id }, { entityId: { in: row.findings.map((f) => f.id) } }, { entityId: row.assetId, action: { startsWith: "inspection." } }] },
      orderBy: { createdAt: "desc" }, take: 60,
    });
    const members = await tx.membership.findMany({ where: { companyId: ctx.companyId, status: "ACTIVE" }, include: { user: { select: { name: true } } } });
    const warnings = inspectionWarnings({
      rating: row.conditionRating, responses: row.responses.map((r) => ({ result: r.result, note: r.note })),
      findings: row.findings.map((f) => ({ severity: f.severity, safetyRisk: f.safetyRisk, recommendedAction: f.recommendedAction })),
    });
    return {
      inspection: row, photos, warnings, history,
      names: Object.fromEntries(users.map((u) => [u.id, u.name])) as Record<string, string>,
      memberNames: Object.fromEntries(members.map((m) => [m.id, m.user.name])) as Record<string, string>,
    };
  });
}

/** Approved inspections for an asset, oldest first, with how the condition moved between them. */
export async function conditionHistory(ctx: Ctx, assetId: string) {
  assertCan(ctx, "asset.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const rows = await tx.inspection.findMany({
      where: { companyId: ctx.companyId, assetId, status: "APPROVED", conditionRating: { not: null } },
      orderBy: [{ conductedOn: "asc" }, { createdAt: "asc" }],
      select: { id: true, ref: true, purpose: true, conductedOn: true, conditionRating: true, summary: true },
    });
    return rows.map((r, i) => ({
      ...r, rating: r.conditionRating as Rating,
      change: i === 0 ? null : conditionChange(rows[i - 1].conditionRating as Rating, r.conditionRating as Rating),
    }));
  });
}
