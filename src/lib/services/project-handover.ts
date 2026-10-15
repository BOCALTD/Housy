import { z } from "zod";
import { withTenant, type Tx } from "../db";
import { logActivity } from "../audit";
import { parseDateOnly, todayInLagos } from "../dates";
import {
  completionProblems, DEFAULT_DEFECTS_MONTHS, defectsOpenForRaising, defectsPeriodEnd, defectState, DEFECT_SEVERITIES, DOC_KINDS, handoverProblems, HANDOVER_CHECKLIST,
  warrantyProblem, warrantyState,
} from "../project-rules";
import { readStoredFile, saveFile, validateUpload } from "../storage";
import { reportWorkOrderInTx } from "./maintenance";
import type { Upload } from "./photos";
import { latestValuationForAsset } from "./valuation";
import { lockProject } from "./project";
import { assertCan, type Ctx } from "./context";

// Completion, defects, warranties, documents and handover (master prompt Phase 7). A project is completed only when
// someone other than the person who asked for it approves, the checks run again under a lock at that moment, and a
// fix to a defect is verified by someone other than the person who fixed it. Completion links the project to its asset.

export { DEFECT_SEVERITIES, DOC_KINDS };

const text = (max: number) => z.string().trim().max(max).default("");
const optionalId = z.string().optional().transform((v) => v || null);
const optionalDate = z.string().trim().optional().transform((v) => (v ? parseDateOnly(v) : null));
const requiredDate = (label: string) => z.string().trim().min(1, `Enter ${label}`).transform((v) => parseDateOnly(v));

async function nameMap(tx: Tx, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const users = unique.length ? await tx.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } }) : [];
  return Object.fromEntries(users.map((u) => [u.id, u.name])) as Record<string, string>;
}

async function completionFacts(tx: Tx, companyId: string, projectId: string) {
  const [packages, openCriticalDefects, commitments, variations, pendingInvoices, unpaidApprovedInvoices] = await Promise.all([
    tx.workPackage.findMany({ where: { companyId, projectId }, select: { status: true } }),
    tx.projectDefect.count({ where: { companyId, projectId, severity: "CRITICAL", status: { not: "VERIFIED" } } }),
    tx.commitment.count({ where: { companyId, projectId, status: "PENDING" } }),
    tx.variation.count({ where: { companyId, projectId, status: "PENDING" } }),
    tx.projectInvoice.count({ where: { companyId, projectId, status: "RECEIVED" } }),
    tx.projectInvoice.count({ where: { companyId, projectId, status: "APPROVED" } }),
  ]);
  return { packages, openCriticalDefects, pendingDecisions: commitments + variations, pendingInvoices, unpaidApprovedInvoices };
}

// ---------- Completion ----------

const requestSchema = z.object({
  note: text(2000),
  defectsMonths: z.string().trim().optional().transform((v) => (v === undefined || v === "" ? DEFAULT_DEFECTS_MONTHS : Number(v)))
    .refine((n) => Number.isInteger(n) && n >= 0 && n <= 60, "The defects period is 0 to 60 months"),
});

export async function requestCompletion(ctx: Ctx, projectId: string, raw: z.input<typeof requestSchema>) {
  assertCan(ctx, "project.plan");
  const d = requestSchema.parse(raw);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const p = await lockProject(tx, ctx, projectId);
    if (p.status !== "ACTIVE") throw new Error("Only an active project can be put forward for completion");
    if (p.completionRequestedById) throw new Error("Completion has already been requested and is waiting for a decision");
    const { blocks } = completionProblems(await completionFacts(tx, ctx.companyId, projectId));
    if (blocks.length > 0) throw new Error(`The project is not ready to complete. ${blocks.join(". ")}`);
    await tx.project.update({ where: { id: projectId }, data: { completionRequestedById: ctx.userId, completionRequestedAt: new Date(), completionNote: d.note, defectsMonths: d.defectsMonths } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: projectId, action: "project.completion_requested", detail: { defectsMonths: d.defectsMonths } });
  });
}

export async function withdrawCompletion(ctx: Ctx, projectId: string) {
  assertCan(ctx, "project.plan");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const p = await lockProject(tx, ctx, projectId);
    if (p.status !== "ACTIVE" || !p.completionRequestedById) throw new Error("There is no completion request to withdraw");
    if (p.completionRequestedById !== ctx.userId) assertCan(ctx, "project.manage");
    await tx.project.update({ where: { id: projectId }, data: { completionRequestedById: null, completionRequestedAt: null, completionNote: "" } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: projectId, action: "project.completion_withdrawn", detail: {} });
  });
}

/** Approve or reject completion. The approver cannot be the person who asked, and the checks run again under the lock. */
export async function decideCompletion(ctx: Ctx, projectId: string, decision: "approve" | "reject", noteInput: string) {
  assertCan(ctx, "project.approve");
  const note = z.string().trim().max(1000).parse(noteInput);
  if (decision === "reject" && note.length < 3) throw new Error("Say why completion is not accepted");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const p = await lockProject(tx, ctx, projectId);
    if (p.status !== "ACTIVE" || !p.completionRequestedById) throw new Error("There is no completion request waiting for a decision");
    if (p.completionRequestedById === ctx.userId) throw new Error("Someone other than the person who asked for completion must decide it");
    if (decision === "reject") {
      await tx.project.update({ where: { id: projectId }, data: { completionRequestedById: null, completionRequestedAt: null, completionNote: "" } });
      await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: projectId, action: "project.completion_rejected", detail: { note } });
      return;
    }
    const { blocks } = completionProblems(await completionFacts(tx, ctx.companyId, projectId));
    if (blocks.length > 0) throw new Error(`The project is no longer ready to complete. ${blocks.join(". ")}`);
    const today = todayInLagos();
    await tx.project.update({
      where: { id: projectId },
      data: { status: "COMPLETED", completedById: ctx.userId, completedAt: new Date(), actualEnd: today, defectsPeriodEnd: defectsPeriodEnd(today, p.defectsMonths) },
    });
    await tx.handoverItem.createMany({ data: HANDOVER_CHECKLIST.map((title, i) => ({ companyId: ctx.companyId, projectId, title, sortOrder: i })) });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: projectId, action: "project.completed", detail: { note, defectsMonths: p.defectsMonths } });
    // The asset's own history records that the works were completed.
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: p.assetId, action: "project.completed", detail: { projectId, ref: p.ref, title: p.title } });
  });
}

// ---------- Defects ----------

const defectSchema = z.object({
  title: z.string().trim().min(3, "Describe the defect in a few words").max(200),
  description: text(2000),
  severity: z.enum(DEFECT_SEVERITIES),
  workPackageId: optionalId,
  dueOn: optionalDate,
});

export async function raiseDefect(ctx: Ctx, projectId: string, raw: z.input<typeof defectSchema>) {
  assertCan(ctx, "project.plan");
  const d = defectSchema.parse(raw);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const p = await lockProject(tx, ctx, projectId);
    const today = todayInLagos();
    if (!defectsOpenForRaising(p, today)) throw new Error(p.status === "COMPLETED" ? "The defects liability period for this project has ended" : "Defects can only be raised on a project that is under way or completed");
    if (d.workPackageId) {
      const w = await tx.workPackage.findFirst({ where: { id: d.workPackageId, companyId: ctx.companyId, projectId }, select: { id: true } });
      if (!w) throw new Error("Work package not found");
    }
    if (d.dueOn && d.dueOn.getTime() < today.getTime()) throw new Error("The due date cannot be in the past");
    const count = await tx.projectDefect.count({ where: { companyId: ctx.companyId, projectId } });
    const defect = await tx.projectDefect.create({
      data: { companyId: ctx.companyId, projectId, workPackageId: d.workPackageId, ref: `DEF-${count + 1}`, title: d.title, description: d.description, severity: d.severity, raisedById: ctx.userId, raisedOn: today, dueOn: d.dueOn },
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: projectId, action: "project.defect_raised", detail: { ref: defect.ref, severity: d.severity } });
    return defect;
  });
}

export async function fixDefect(ctx: Ctx, id: string, noteInput: string) {
  assertCan(ctx, "project.plan");
  const note = z.string().trim().min(3, "Say what was done to fix it").max(1000).parse(noteInput);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const found = await tx.projectDefect.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!found) throw new Error("Defect not found");
    const p = await lockProject(tx, ctx, found.projectId);
    if (!defectsOpenForRaising(p, todayInLagos())) throw new Error("The defects liability period for this project has ended");
    const defect = await tx.projectDefect.findFirstOrThrow({ where: { id, companyId: ctx.companyId } });
    if (defect.status !== "OPEN") throw new Error("This defect has already been marked as fixed");
    await tx.projectDefect.update({ where: { id }, data: { status: "FIXED", fixedById: ctx.userId, fixedOn: todayInLagos(), fixNote: note, verifyNote: "" } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: found.projectId, action: "project.defect_fixed", detail: { ref: defect.ref } });
  });
}

/** Confirm a fix, or send it back. The verifier cannot be the person who fixed it. */
export async function verifyDefect(ctx: Ctx, id: string, decision: "verify" | "reject", noteInput: string) {
  assertCan(ctx, "project.plan");
  const note = z.string().trim().max(1000).parse(noteInput);
  if (decision === "reject" && note.length < 3) throw new Error("Say what is still wrong");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const found = await tx.projectDefect.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!found) throw new Error("Defect not found");
    await lockProject(tx, ctx, found.projectId);
    const defect = await tx.projectDefect.findFirstOrThrow({ where: { id, companyId: ctx.companyId } });
    if (defect.status !== "FIXED") throw new Error("Only a defect marked as fixed can be verified");
    if (defect.fixedById === ctx.userId) throw new Error("Someone other than the person who fixed the defect must verify it");
    if (decision === "verify") {
      await tx.projectDefect.update({ where: { id }, data: { status: "VERIFIED", verifiedById: ctx.userId, verifiedOn: todayInLagos(), verifyNote: note } });
    } else {
      await tx.projectDefect.update({ where: { id }, data: { status: "OPEN", fixedById: null, fixedOn: null, verifyNote: note } });
    }
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: found.projectId, action: decision === "verify" ? "project.defect_verified" : "project.defect_sent_back", detail: { ref: defect.ref, note } });
  });
}

/** Turn a defect into a maintenance work order on the asset, once. */
export async function defectToWorkOrder(ctx: Ctx, id: string) {
  assertCan(ctx, "maintenance.request");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM project_defects WHERE id = $1 AND company_id = $2 FOR UPDATE`, id, ctx.companyId);
    if (rows.length === 0) throw new Error("Defect not found");
    const defect = await tx.projectDefect.findFirstOrThrow({ where: { id, companyId: ctx.companyId }, include: { project: { select: { ref: true, assetId: true, title: true } } } });
    if (defect.workOrderId) throw new Error("A work order has already been raised for this defect");
    if (defect.status === "VERIFIED") throw new Error("This defect has already been fixed and verified");
    const priority = defect.severity === "CRITICAL" ? "EMERGENCY" : defect.severity === "HIGH" ? "HIGH" : "NORMAL";
    const wo = await reportWorkOrderInTx(tx, ctx, defect.project.assetId, {
      title: `${defect.project.ref} ${defect.ref}: ${defect.title}`.slice(0, 200),
      description: `Defect from project ${defect.project.ref} (${defect.project.title}). ${defect.description}`.trim(),
      priority, riskLevel: defect.severity,
    } as never);
    await tx.projectDefect.update({ where: { id }, data: { workOrderId: wo.id } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: defect.projectId, action: "project.defect_work_order", detail: { ref: defect.ref, workOrder: wo.ref } });
    return wo;
  });
}

// ---------- Documents and warranties ----------

export async function addProjectDocument(ctx: Ctx, projectId: string, rawKind: string, title: string, file: Upload) {
  assertCan(ctx, "project.plan");
  const kind = z.enum(DOC_KINDS).parse(rawKind);
  const t = z.string().trim().min(2, "Give the document a title").max(200).parse(title);
  validateUpload(file.type, file.bytes);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const p = await lockProject(tx, ctx, projectId);
    if (p.status === "CANCELLED") throw new Error("This project was cancelled, so documents can no longer be added");
    const storageKey = await saveFile(tx, ctx.companyId, file.type, file.bytes);
    const doc = await tx.projectDocument.create({
      data: { companyId: ctx.companyId, projectId, kind, title: t, fileName: file.name.slice(0, 200), mimeType: file.type, sizeBytes: file.bytes.byteLength, storageKey, uploadedById: ctx.userId },
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: projectId, action: "project.document_added", detail: { title: t, kind } });
    return doc;
  });
}

export async function getProjectDocument(ctx: Ctx, documentId: string) {
  assertCan(ctx, "project.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const doc = await tx.projectDocument.findFirst({ where: { id: documentId, companyId: ctx.companyId } });
    if (!doc) return null;
    return { doc, bytes: await readStoredFile(tx, ctx.companyId, doc.storageKey) };
  });
}

const warrantySchema = z.object({
  title: z.string().trim().min(3, "Say what the warranty covers").max(200),
  provider: z.string().trim().max(200).default(""),
  coverage: text(2000),
  startsOn: requiredDate("the date the warranty starts"),
  endsOn: requiredDate("the date the warranty ends"),
  documentId: optionalId,
});

export async function addWarranty(ctx: Ctx, projectId: string, raw: z.input<typeof warrantySchema>) {
  assertCan(ctx, "project.plan");
  const d = warrantySchema.parse(raw);
  const problem = warrantyProblem(d);
  if (problem) throw new Error(problem);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const p = await lockProject(tx, ctx, projectId);
    if (!["ACTIVE", "ON_HOLD", "COMPLETED"].includes(p.status)) throw new Error("Warranties are recorded once the works have started");
    if (d.documentId) {
      const doc = await tx.projectDocument.findFirst({ where: { id: d.documentId, companyId: ctx.companyId, projectId }, select: { id: true } });
      if (!doc) throw new Error("Document not found on this project");
    }
    const w = await tx.projectWarranty.create({
      data: { companyId: ctx.companyId, projectId, assetId: p.assetId, title: d.title, provider: d.provider, coverage: d.coverage, startsOn: d.startsOn, endsOn: d.endsOn, documentId: d.documentId, createdById: ctx.userId },
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: p.assetId, action: "project.warranty_added", detail: { projectId, title: d.title, endsOn: d.endsOn.toISOString().slice(0, 10) } });
    return w;
  });
}

export async function removeWarranty(ctx: Ctx, id: string) {
  assertCan(ctx, "project.manage");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const w = await tx.projectWarranty.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!w) throw new Error("Warranty not found");
    await lockProject(tx, ctx, w.projectId);
    await tx.projectWarranty.delete({ where: { id } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: w.assetId, action: "project.warranty_removed", detail: { projectId: w.projectId, title: w.title } });
  });
}

// ---------- Handover ----------

export async function tickHandoverItem(ctx: Ctx, itemId: string, done: boolean, noteInput: string) {
  assertCan(ctx, "project.plan");
  const note = z.string().trim().max(500).parse(noteInput);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const item = await tx.handoverItem.findFirst({ where: { id: itemId, companyId: ctx.companyId } });
    if (!item) throw new Error("Checklist item not found");
    const p = await lockProject(tx, ctx, item.projectId);
    if (p.status !== "COMPLETED") throw new Error("The handover checklist applies to a completed project");
    if (p.handoverOn) throw new Error("The handover has been recorded, so the checklist can no longer change");
    await tx.handoverItem.update({ where: { id: itemId }, data: done ? { done: true, doneById: ctx.userId, doneOn: todayInLagos(), note } : { done: false, doneById: null, doneOn: null, note } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: item.projectId, action: done ? "project.handover_item_done" : "project.handover_item_undone", detail: { title: item.title } });
  });
}

export async function addHandoverItem(ctx: Ctx, projectId: string, titleInput: string) {
  assertCan(ctx, "project.plan");
  const title = z.string().trim().min(3, "Describe the checklist item").max(200).parse(titleInput);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const p = await lockProject(tx, ctx, projectId);
    if (p.status !== "COMPLETED") throw new Error("The handover checklist applies to a completed project");
    if (p.handoverOn) throw new Error("The handover has been recorded, so the checklist can no longer change");
    const count = await tx.handoverItem.count({ where: { companyId: ctx.companyId, projectId } });
    await tx.handoverItem.create({ data: { companyId: ctx.companyId, projectId, title, sortOrder: count } });
  });
}

const handoverSchema = z.object({ handedTo: z.string().trim().max(200).default(""), note: text(2000), handoverOn: optionalDate });

export async function recordHandover(ctx: Ctx, projectId: string, raw: z.input<typeof handoverSchema>) {
  assertCan(ctx, "project.manage");
  const d = handoverSchema.parse(raw);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const p = await lockProject(tx, ctx, projectId);
    if (p.status !== "COMPLETED") throw new Error("Only a completed project can be handed over");
    if (p.handoverOn) throw new Error("This project has already been handed over");
    const items = await tx.handoverItem.findMany({ where: { companyId: ctx.companyId, projectId }, select: { done: true } });
    const openSeriousDefects = await tx.projectDefect.count({ where: { companyId: ctx.companyId, projectId, severity: { in: ["HIGH", "CRITICAL"] }, status: { not: "VERIFIED" } } });
    const problems = handoverProblems({ items, openSeriousDefects, handedTo: d.handedTo });
    if (problems.length > 0) throw new Error(`The handover cannot be recorded yet. ${problems.join(". ")}`);
    const on = d.handoverOn ?? todayInLagos();
    if (on.getTime() > todayInLagos().getTime()) throw new Error("The handover date cannot be in the future");
    if (p.completedAt && on.getTime() < Date.UTC(p.completedAt.getUTCFullYear(), p.completedAt.getUTCMonth(), p.completedAt.getUTCDate()) - 864e5) throw new Error("The handover cannot be dated before the project was completed");
    await tx.project.update({ where: { id: projectId }, data: { handoverOn: on, handoverById: ctx.userId, handedToName: d.handedTo, handoverNote: d.note } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: projectId, action: "project.handed_over", detail: { handedTo: d.handedTo } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: p.assetId, action: "project.handed_over", detail: { projectId, ref: p.ref, handedTo: d.handedTo } });
  });
}

// ---------- Reading ----------

export async function getProjectHandover(ctx: Ctx, projectId: string) {
  assertCan(ctx, "project.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const project = await tx.project.findFirst({ where: { id: projectId, companyId: ctx.companyId }, include: { asset: { select: { id: true, ref: true, name: true } } } });
    if (!project) return null;
    const [defects, warranties, documents, items, packages] = await Promise.all([
      tx.projectDefect.findMany({ where: { companyId: ctx.companyId, projectId }, orderBy: { createdAt: "asc" } }),
      tx.projectWarranty.findMany({ where: { companyId: ctx.companyId, projectId }, orderBy: { endsOn: "asc" } }),
      tx.projectDocument.findMany({ where: { companyId: ctx.companyId, projectId }, orderBy: { createdAt: "desc" } }),
      tx.handoverItem.findMany({ where: { companyId: ctx.companyId, projectId }, orderBy: { sortOrder: "asc" } }),
      tx.workPackage.findMany({ where: { companyId: ctx.companyId, projectId }, select: { id: true, code: true, title: true }, orderBy: { sortOrder: "asc" } }),
    ]);
    const readiness = completionProblems(await completionFacts(tx, ctx.companyId, projectId));
    const names = await nameMap(tx, [
      project.completionRequestedById, project.completedById, project.handoverById,
      ...defects.flatMap((d) => [d.raisedById, d.fixedById, d.verifiedById]), ...items.map((i) => i.doneById), ...documents.map((d) => d.uploadedById),
    ]);
    const today = todayInLagos();
    return {
      project, packages, documents, items, readiness, names,
      raisable: defectsOpenForRaising(project, today),
      defects: defects.map((d) => ({ ...d, state: defectState(d, today) })),
      warranties: warranties.map((w) => ({ ...w, state: warrantyState(w, today) })),
      handoverProblems: handoverProblems({
        items, handedTo: "x",
        openSeriousDefects: defects.filter((d) => (d.severity === "HIGH" || d.severity === "CRITICAL") && d.status !== "VERIFIED").length,
      }),
    };
  });
}

/** Projects, warranties and the latest approved valuation on one asset, for its page. */
export async function assetProjectHistory(ctx: Ctx, assetId: string) {
  assertCan(ctx, "project.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const today = todayInLagos();
    const [projects, warranties, openDefects] = await Promise.all([
      tx.project.findMany({
        where: { companyId: ctx.companyId, assetId }, orderBy: { createdAt: "desc" }, take: 20,
        select: { id: true, ref: true, title: true, kind: true, status: true, completedAt: true, handoverOn: true, defectsPeriodEnd: true, plannedEnd: true },
      }),
      tx.projectWarranty.findMany({ where: { companyId: ctx.companyId, assetId }, orderBy: { endsOn: "asc" }, take: 50 }),
      tx.projectDefect.count({ where: { companyId: ctx.companyId, project: { assetId }, status: { not: "VERIFIED" } } }),
    ]);
    const valuation = await latestValuationForAsset(tx, ctx.companyId, assetId).catch(() => null);
    return { projects, openDefects, valuation, warranties: warranties.map((w) => ({ ...w, state: warrantyState(w, today) })) };
  });
}
