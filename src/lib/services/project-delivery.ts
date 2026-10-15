import { z } from "zod";
import { withTenant, type Tx } from "../db";
import { logActivity } from "../audit";
import { parseDateOnly, todayInLagos } from "../dates";
import { deliveryProblem, overallPercent, PARTY_ROLES, procurementState, riskLevel, riskProblem, riskReviewOverdue, riskScore, SITE_OUTCOMES } from "../project-rules";
import { receiveStockInTx } from "./inventory";
import { photosFor, savePhoto, type Upload } from "./photos";
import { lockProject } from "./project";
import { assertCan, type Ctx } from "./context";

// Project delivery (master prompt Phase 7): the parties on the job, procurement and deliveries, stock used,
// the risk register, site inspections, progress reports and quality checks. Site inspections and progress
// reports are recorded once and never edited. A work package is not done while a quality check is open.

export { PARTY_ROLES, SITE_OUTCOMES };

const OPEN = ["PLANNING", "ACTIVE", "ON_HOLD"];
const RUNNING = ["ACTIVE", "ON_HOLD"];
const text = (max: number) => z.string().trim().max(max).default("");
const optionalId = z.string().optional().transform((v) => v || null);
const optionalDate = z.string().trim().optional().transform((v) => (v ? parseDateOnly(v) : null));
const requiredDate = (label: string) => z.string().trim().min(1, `Enter ${label}`).transform((v) => parseDateOnly(v));

function needOpen(p: { status: string }) {
  if (!OPEN.includes(p.status)) throw new Error("This project is closed, so it can no longer be changed");
}
function needRunning(p: { status: string }) {
  if (!RUNNING.includes(p.status)) throw new Error("This can only be recorded while the project is under way");
}

async function checkPackage(tx: Tx, companyId: string, projectId: string, id: string | null) {
  if (!id) return;
  const w = await tx.workPackage.findFirst({ where: { id, companyId, projectId }, select: { id: true } });
  if (!w) throw new Error("Work package not found");
}

async function activeMember(tx: Tx, companyId: string, membershipId: string | null) {
  if (!membershipId) return;
  const m = await tx.membership.findFirst({ where: { id: membershipId, companyId, status: "ACTIVE" }, select: { id: true } });
  if (!m) throw new Error("Choose an active member of your company");
}

async function nameMap(tx: Tx, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const users = unique.length ? await tx.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } }) : [];
  return Object.fromEntries(users.map((u) => [u.id, u.name])) as Record<string, string>;
}

// ---------- Parties ----------

const partySchema = z.object({
  role: z.enum(PARTY_ROLES),
  contractorId: optionalId,
  name: z.string().trim().max(200).default(""),
  scope: text(1000),
  email: text(200),
  phone: text(50),
  appointedOn: optionalDate,
});

export async function appointParty(ctx: Ctx, projectId: string, raw: z.input<typeof partySchema>) {
  assertCan(ctx, "project.plan");
  const d = partySchema.parse(raw);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const p = await lockProject(tx, ctx, projectId);
    needOpen(p);
    let name = d.name;
    if (d.contractorId) {
      const c = await tx.contractor.findFirst({ where: { id: d.contractorId, companyId: ctx.companyId } });
      if (!c) throw new Error("Contractor not found");
      name = name || c.name;
    }
    if (name.length < 2) throw new Error("Enter the name, or choose a contractor");
    const dup = await tx.projectParty.findFirst({ where: { companyId: ctx.companyId, projectId, role: d.role, name }, select: { id: true } });
    if (dup) throw new Error("That party is already appointed in that role");
    const party = await tx.projectParty.create({
      data: { companyId: ctx.companyId, projectId, role: d.role, contractorId: d.contractorId, name, scope: d.scope, email: d.email, phone: d.phone, appointedOn: d.appointedOn ?? todayInLagos(), createdById: ctx.userId },
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: projectId, action: "project.party_appointed", detail: { name, role: d.role } });
    return party;
  });
}

export async function endParty(ctx: Ctx, partyId: string) {
  assertCan(ctx, "project.plan");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const party = await tx.projectParty.findFirst({ where: { id: partyId, companyId: ctx.companyId } });
    if (!party) throw new Error("Party not found");
    const p = await lockProject(tx, ctx, party.projectId);
    needOpen(p);
    if (party.endedOn) throw new Error("This appointment has already ended");
    await tx.projectParty.update({ where: { id: partyId }, data: { endedOn: todayInLagos() } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: party.projectId, action: "project.party_ended", detail: { name: party.name } });
    return party.projectId;
  });
}

// ---------- Procurement ----------

const procurementSchema = z.object({
  description: z.string().trim().min(3, "Describe what is needed").max(500),
  quantity: z.string().trim().regex(/^\d{1,7}$/, "Enter the quantity as a whole number").transform(Number),
  unit: z.string().trim().max(30).default("pcs").transform((v) => v || "pcs"),
  requiredBy: requiredDate("the date it is needed by"),
  workPackageId: optionalId,
  note: text(500),
});

export async function addProcurement(ctx: Ctx, projectId: string, raw: z.input<typeof procurementSchema>) {
  assertCan(ctx, "project.plan");
  const d = procurementSchema.parse(raw);
  if (d.quantity <= 0) throw new Error("Enter a quantity of one or more");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const p = await lockProject(tx, ctx, projectId);
    needOpen(p);
    await checkPackage(tx, ctx.companyId, projectId, d.workPackageId);
    const item = await tx.procurementItem.create({
      data: { companyId: ctx.companyId, projectId, workPackageId: d.workPackageId, description: d.description, quantity: d.quantity, unit: d.unit, requiredBy: d.requiredBy, note: d.note, createdById: ctx.userId },
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: projectId, action: "project.procurement_added", detail: { description: d.description, quantity: d.quantity } });
    return item;
  });
}

const orderSchema = z.object({
  supplierName: z.string().trim().min(2, "Enter the supplier").max(200),
  commitmentId: optionalId,
  orderedOn: optionalDate,
});

export async function orderProcurement(ctx: Ctx, id: string, raw: z.input<typeof orderSchema>) {
  assertCan(ctx, "project.cost");
  const d = orderSchema.parse(raw);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const item = await tx.procurementItem.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!item) throw new Error("Procurement item not found");
    const p = await lockProject(tx, ctx, item.projectId);
    needRunning(p);
    const fresh = await tx.procurementItem.findFirstOrThrow({ where: { id, companyId: ctx.companyId } });
    if (fresh.status !== "REQUIRED") throw new Error("This item has already been ordered or closed");
    if (d.commitmentId) {
      const c = await tx.commitment.findFirst({ where: { id: d.commitmentId, companyId: ctx.companyId, projectId: item.projectId, status: "APPROVED" }, select: { id: true } });
      if (!c) throw new Error("Choose an approved commitment on this project, so the order is covered by approved spending");
    }
    const on = d.orderedOn ?? todayInLagos();
    if (on.getTime() > todayInLagos().getTime()) throw new Error("The order date cannot be in the future");
    await tx.procurementItem.update({ where: { id }, data: { status: "ORDERED", supplierName: d.supplierName, commitmentId: d.commitmentId, orderedOn: on } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: item.projectId, action: "project.procurement_ordered", detail: { description: item.description, supplier: d.supplierName } });
    return item.projectId;
  });
}

const deliverySchema = z.object({
  quantity: z.string().trim(),
  deliveredOn: optionalDate,
  inventoryItemId: optionalId,
});

/** Record a delivery. If an inventory item is named, the delivered quantity is booked into stock in the same step. */
export async function recordDelivery(ctx: Ctx, id: string, raw: z.input<typeof deliverySchema>) {
  assertCan(ctx, "project.plan");
  const d = deliverySchema.parse(raw);
  const qty = /^\d{1,7}$/.test(d.quantity) ? Number(d.quantity) : 0;
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const item = await tx.procurementItem.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!item) throw new Error("Procurement item not found");
    const p = await lockProject(tx, ctx, item.projectId);
    needRunning(p);
    const fresh = await tx.procurementItem.findFirstOrThrow({ where: { id, companyId: ctx.companyId } });
    if (fresh.status !== "ORDERED") throw new Error("Only an ordered item can be delivered");
    const problem = deliveryProblem({ quantity: fresh.quantity, deliveredSoFar: fresh.deliveredQty, receiving: qty });
    if (problem) throw new Error(problem);
    const on = d.deliveredOn ?? todayInLagos();
    if (on.getTime() > todayInLagos().getTime()) throw new Error("The delivery date cannot be in the future");
    if (d.inventoryItemId) await receiveStockInTx(tx, ctx, d.inventoryItemId, qty, `${p.ref} delivery`);
    const total = fresh.deliveredQty + qty;
    await tx.procurementItem.update({
      where: { id },
      data: { deliveredQty: total, deliveredOn: on, status: total >= fresh.quantity ? "DELIVERED" : "ORDERED", inventoryItemId: d.inventoryItemId ?? fresh.inventoryItemId },
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: item.projectId, action: "project.delivery", detail: { description: item.description, quantity: qty, total, intoStock: !!d.inventoryItemId } });
    return item.projectId;
  });
}

export async function cancelProcurement(ctx: Ctx, id: string) {
  assertCan(ctx, "project.plan");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const item = await tx.procurementItem.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!item) throw new Error("Procurement item not found");
    const p = await lockProject(tx, ctx, item.projectId);
    needOpen(p);
    const fresh = await tx.procurementItem.findFirstOrThrow({ where: { id, companyId: ctx.companyId } });
    if (fresh.status === "DELIVERED" || fresh.status === "CANCELLED") throw new Error("This item is already closed");
    if (fresh.deliveredQty > 0) throw new Error("Part of this order has been delivered, so it cannot be cancelled");
    await tx.procurementItem.update({ where: { id }, data: { status: "CANCELLED" } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: item.projectId, action: "project.procurement_cancelled", detail: { description: item.description } });
    return item.projectId;
  });
}

// ---------- Risks ----------

const riskSchema = z.object({
  title: z.string().trim().min(3, "Name the risk").max(200),
  description: text(2000),
  category: text(100),
  likelihood: z.string().trim().regex(/^[1-5]$/, "Likelihood is 1 to 5").transform(Number),
  impact: z.string().trim().regex(/^[1-5]$/, "Impact is 1 to 5").transform(Number),
  ownerId: optionalId,
  mitigation: text(2000),
  reviewOn: optionalDate,
});

export async function addRisk(ctx: Ctx, projectId: string, raw: z.input<typeof riskSchema>) {
  assertCan(ctx, "project.plan");
  const d = riskSchema.parse(raw);
  const problem = riskProblem(d);
  if (problem) throw new Error(problem);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const p = await lockProject(tx, ctx, projectId);
    needOpen(p);
    await activeMember(tx, ctx.companyId, d.ownerId);
    const count = await tx.projectRisk.count({ where: { companyId: ctx.companyId, projectId } });
    const risk = await tx.projectRisk.create({
      data: { companyId: ctx.companyId, projectId, ref: `RSK-${count + 1}`, title: d.title, description: d.description, category: d.category, likelihood: d.likelihood, impact: d.impact, ownerId: d.ownerId, mitigation: d.mitigation, reviewOn: d.reviewOn, createdById: ctx.userId },
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: projectId, action: "project.risk_added", detail: { ref: risk.ref, score: riskScore(d.likelihood, d.impact) } });
    return risk;
  });
}

const riskUpdateSchema = riskSchema.extend({
  status: z.enum(["OPEN", "MITIGATING", "CLOSED", "OCCURRED"]),
  closeNote: text(1000),
});

export async function updateRisk(ctx: Ctx, id: string, raw: z.input<typeof riskUpdateSchema>) {
  assertCan(ctx, "project.plan");
  const d = riskUpdateSchema.parse(raw);
  const problem = riskProblem(d);
  if (problem) throw new Error(problem);
  if (d.status === "CLOSED" && d.closeNote.length < 3) throw new Error("Say why the risk is closed");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const r = await tx.projectRisk.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!r) throw new Error("Risk not found");
    const p = await lockProject(tx, ctx, r.projectId);
    needOpen(p);
    if (r.status === "CLOSED") throw new Error("A closed risk cannot be changed");
    await activeMember(tx, ctx.companyId, d.ownerId);
    await tx.projectRisk.update({
      where: { id },
      data: {
        title: d.title, description: d.description, category: d.category, likelihood: d.likelihood, impact: d.impact, ownerId: d.ownerId, mitigation: d.mitigation, reviewOn: d.reviewOn,
        status: d.status, closeNote: d.status === "CLOSED" ? d.closeNote : "", closedAt: d.status === "CLOSED" ? new Date() : null,
      },
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: r.projectId, action: "project.risk_updated", detail: { ref: r.ref, status: d.status, score: riskScore(d.likelihood, d.impact) } });
    return r.projectId;
  });
}

// ---------- Site inspections and progress reports ----------

const siteSchema = z.object({
  inspectedOn: requiredDate("the inspection date"),
  workPackageId: optionalId,
  summary: z.string().trim().min(5, "Describe what was seen").max(4000),
  actions: text(2000),
  outcome: z.enum(SITE_OUTCOMES),
});

export async function recordSiteInspection(ctx: Ctx, projectId: string, raw: z.input<typeof siteSchema>) {
  assertCan(ctx, "project.plan");
  const d = siteSchema.parse(raw);
  if (d.inspectedOn.getTime() > todayInLagos().getTime()) throw new Error("The inspection date cannot be in the future");
  if (d.outcome !== "SATISFACTORY" && d.actions.length < 3) throw new Error("Say what must be done, because the site was not found satisfactory");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const p = await lockProject(tx, ctx, projectId);
    needRunning(p);
    await checkPackage(tx, ctx.companyId, projectId, d.workPackageId);
    const s = await tx.siteInspection.create({
      data: { companyId: ctx.companyId, projectId, workPackageId: d.workPackageId, inspectedOn: d.inspectedOn, inspectorId: ctx.userId, summary: d.summary, actions: d.actions, outcome: d.outcome },
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: projectId, action: "project.site_inspection", detail: { outcome: d.outcome } });
    return s;
  });
}

export async function addSitePhoto(ctx: Ctx, inspectionId: string, meta: { phase?: string; caption?: string }, file: Upload) {
  assertCan(ctx, "project.plan");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const s = await tx.siteInspection.findFirst({ where: { id: inspectionId, companyId: ctx.companyId } });
    if (!s) throw new Error("Site inspection not found");
    const p = await lockProject(tx, ctx, s.projectId);
    needRunning(p);
    return savePhoto(tx, ctx, "site_inspection", inspectionId, { phase: "EVIDENCE", caption: meta.caption ?? "" }, file);
  });
}

const updateSchema = z.object({
  reportDate: optionalDate,
  summary: z.string().trim().min(5, "Summarise the progress").max(4000),
  issues: text(2000),
  nextSteps: text(2000),
});

export async function recordProgressUpdate(ctx: Ctx, projectId: string, raw: z.input<typeof updateSchema>) {
  assertCan(ctx, "project.plan");
  const d = updateSchema.parse(raw);
  const date = d.reportDate ?? todayInLagos();
  if (date.getTime() > todayInLagos().getTime()) throw new Error("The report date cannot be in the future");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const p = await lockProject(tx, ctx, projectId);
    needRunning(p);
    const wps = await tx.workPackage.findMany({ where: { companyId: ctx.companyId, projectId }, select: { percentComplete: true, budgetKobo: true } });
    const u = await tx.progressUpdate.create({
      data: { companyId: ctx.companyId, projectId, reportDate: date, summary: d.summary, issues: d.issues, nextSteps: d.nextSteps, percentComplete: overallPercent(wps), recordedById: ctx.userId },
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: projectId, action: "project.progress_report", detail: { percent: u.percentComplete } });
    return u;
  });
}

// ---------- Quality checks ----------

export async function addQualityCheck(ctx: Ctx, workPackageId: string, raw: { title: string; standard?: string }) {
  assertCan(ctx, "project.plan");
  const title = z.string().trim().min(3, "Name what is being checked").max(200).parse(raw.title);
  const standard = z.string().trim().max(300).parse(raw.standard ?? "");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const w = await tx.workPackage.findFirst({ where: { id: workPackageId, companyId: ctx.companyId } });
    if (!w) throw new Error("Work package not found");
    const p = await lockProject(tx, ctx, w.projectId);
    needOpen(p);
    if (w.status === "DONE") throw new Error("This work package is already done. Raise a defect instead");
    const c = await tx.qualityCheck.create({ data: { companyId: ctx.companyId, projectId: w.projectId, workPackageId, title, standard, createdById: ctx.userId } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: w.projectId, action: "project.quality_check_added", detail: { code: w.code, title } });
    return c;
  });
}

/** Pass or fail a check. The person responsible for the work cannot pass their own work. */
export async function recordQualityResult(ctx: Ctx, id: string, rawResult: string, note: string) {
  assertCan(ctx, "project.plan");
  const result = z.enum(["PASSED", "FAILED"]).parse(rawResult);
  const n = z.string().trim().max(1000).parse(note);
  if (result === "FAILED" && n.length < 3) throw new Error("Say what failed");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const c = await tx.qualityCheck.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!c) throw new Error("Quality check not found");
    const p = await lockProject(tx, ctx, c.projectId);
    needRunning(p);
    const w = await tx.workPackage.findFirstOrThrow({ where: { id: c.workPackageId, companyId: ctx.companyId } });
    if (w.responsibleId && w.responsibleId === ctx.membershipId) throw new Error("Someone other than the person responsible for the work must check it");
    const fresh = await tx.qualityCheck.findFirstOrThrow({ where: { id, companyId: ctx.companyId } });
    if (fresh.result === "PASSED" || fresh.result === "WAIVED") throw new Error("This check is already settled");
    await tx.qualityCheck.update({ where: { id }, data: { result, checkedById: ctx.userId, checkedOn: todayInLagos(), note: n } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: c.projectId, action: "project.quality_result", detail: { title: c.title, result, note: n } });
    return c.projectId;
  });
}

/** Waive a check, with a reason, when it will not be carried out. Needs approval rights. */
export async function waiveQualityCheck(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "project.approve");
  const why = z.string().trim().min(5, "Give the reason for waiving the check").max(1000).parse(reason);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const c = await tx.qualityCheck.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!c) throw new Error("Quality check not found");
    const p = await lockProject(tx, ctx, c.projectId);
    needRunning(p);
    const w = await tx.workPackage.findFirstOrThrow({ where: { id: c.workPackageId, companyId: ctx.companyId } });
    if (w.responsibleId && w.responsibleId === ctx.membershipId) throw new Error("Someone other than the person responsible for the work must waive the check");
    const fresh = await tx.qualityCheck.findFirstOrThrow({ where: { id, companyId: ctx.companyId } });
    if (fresh.result === "PASSED" || fresh.result === "WAIVED") throw new Error("This check is already settled");
    await tx.qualityCheck.update({ where: { id }, data: { result: "WAIVED", checkedById: ctx.userId, checkedOn: todayInLagos(), note: why } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: c.projectId, action: "project.quality_waived", detail: { title: c.title, reason: why } });
    return c.projectId;
  });
}

export async function addQualityPhoto(ctx: Ctx, checkId: string, meta: { caption?: string }, file: Upload) {
  assertCan(ctx, "project.plan");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const c = await tx.qualityCheck.findFirst({ where: { id: checkId, companyId: ctx.companyId } });
    if (!c) throw new Error("Quality check not found");
    const p = await lockProject(tx, ctx, c.projectId);
    needRunning(p);
    return savePhoto(tx, ctx, "quality_check", checkId, { phase: "EVIDENCE", caption: meta.caption ?? "" }, file);
  });
}

// ---------- Reading ----------

export async function getProjectDelivery(ctx: Ctx, projectId: string) {
  assertCan(ctx, "project.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const project = await tx.project.findFirst({ where: { id: projectId, companyId: ctx.companyId }, include: { asset: { select: { id: true, ref: true, name: true } } } });
    if (!project) return null;
    const [parties, procurement, stockUses, risks, inspections, updates, checks, packages, members, contractors, consumables] = await Promise.all([
      tx.projectParty.findMany({ where: { companyId: ctx.companyId, projectId }, orderBy: { createdAt: "asc" } }),
      tx.procurementItem.findMany({ where: { companyId: ctx.companyId, projectId }, orderBy: { requiredBy: "asc" } }),
      tx.projectStockUse.findMany({ where: { companyId: ctx.companyId, projectId }, orderBy: { createdAt: "desc" }, include: { item: { select: { itemNo: true, name: true, unit: true } } } }),
      tx.projectRisk.findMany({ where: { companyId: ctx.companyId, projectId }, orderBy: { createdAt: "asc" } }),
      tx.siteInspection.findMany({ where: { companyId: ctx.companyId, projectId }, orderBy: { inspectedOn: "desc" }, take: 100 }),
      tx.progressUpdate.findMany({ where: { companyId: ctx.companyId, projectId }, orderBy: { reportDate: "desc" }, take: 100 }),
      tx.qualityCheck.findMany({ where: { companyId: ctx.companyId, projectId }, orderBy: { createdAt: "asc" } }),
      tx.workPackage.findMany({ where: { companyId: ctx.companyId, projectId }, orderBy: { sortOrder: "asc" } }),
      tx.membership.findMany({ where: { companyId: ctx.companyId, status: "ACTIVE" }, include: { user: { select: { name: true } } } }),
      tx.contractor.findMany({ where: { companyId: ctx.companyId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      tx.inventoryItem.findMany({ where: { companyId: ctx.companyId, status: "ACTIVE", kind: "CONSUMABLE" }, select: { id: true, itemNo: true, name: true, quantity: true, unit: true }, orderBy: { itemNo: "asc" } }),
    ]);
    const commitments = await tx.commitment.findMany({ where: { companyId: ctx.companyId, projectId, status: "APPROVED" }, select: { id: true, ref: true, supplierName: true } });
    const sitePhotos = await photosFor(tx, ctx.companyId, "site_inspection", inspections.map((i) => i.id));
    const qualityPhotos = await photosFor(tx, ctx.companyId, "quality_check", checks.map((c) => c.id));
    const names = await nameMap(tx, [...inspections.map((i) => i.inspectorId), ...updates.map((u) => u.recordedById), ...checks.map((c) => c.checkedById)]);
    const today = todayInLagos();
    return {
      project, parties, packages, commitments, consumables, contractors, names, members: members.map((m) => ({ id: m.id, name: m.user.name })),
      procurement: procurement.map((i) => ({ ...i, state: procurementState(i, today) })),
      stockUses, inspections, updates, sitePhotos, qualityPhotos, checks,
      risks: risks.map((r) => ({ ...r, score: riskScore(r.likelihood, r.impact), level: riskLevel(riskScore(r.likelihood, r.impact)), reviewOverdue: riskReviewOverdue(r, today) })),
    };
  });
}

export type DeliveryView = NonNullable<Awaited<ReturnType<typeof getProjectDelivery>>>;

/** Counts used on the projects list and dashboards. */
export async function deliveryAlerts(tx: Tx, companyId: string, projectId: string) {
  const today = todayInLagos();
  const [items, risks, checks] = await Promise.all([
    tx.procurementItem.findMany({ where: { companyId, projectId, status: { in: ["REQUIRED", "ORDERED"] } }, select: { status: true, requiredBy: true } }),
    tx.projectRisk.findMany({ where: { companyId, projectId, status: { in: ["OPEN", "MITIGATING"] } }, select: { status: true, reviewOn: true, likelihood: true, impact: true } }),
    tx.qualityCheck.count({ where: { companyId, projectId, result: "FAILED" } }),
  ]);
  return {
    lateProcurement: items.filter((i) => procurementState(i, today) === "LATE").length,
    highRisks: risks.filter((r) => riskLevel(riskScore(r.likelihood, r.impact)) === "HIGH").length,
    overdueRiskReviews: risks.filter((r) => riskReviewOverdue(r, today)).length,
    failedChecks: checks,
  };
}
