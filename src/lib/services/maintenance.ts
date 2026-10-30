import { z } from "zod";
import { withTenant, type Tx } from "../db";
import { logActivity } from "../audit";
import { parseNairaToKobo } from "../money";
import { addMonthsClamped, parseDateOnly, todayInLagos } from "../dates";
import { nextNumber } from "../numbering";
import { lockKey } from "../locks";
import {
  closureProblem, completionProblem, dueOccurrences, isUnattendedUrgent, materialsTotal, OPEN_STATUSES, transitionProblem, URGENT_UNATTENDED_HOURS, type WoStatus,
} from "../maintenance-rules";
import { can } from "../permissions";
import { savePhoto, photosFor, type Upload } from "./photos";
import { assertCan, type Ctx } from "./context";

// Maintenance and work orders (master prompt Section 18).
// Reported → Triaged → Approved → Assigned → In progress → Awaiting parts → Inspection required → Completed → Closed.

export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "EMERGENCY"] as const;
export const RISKS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

async function lockWorkOrder(tx: Tx, id: string, companyId: string) {
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM work_orders WHERE id = $1 AND company_id = $2 FOR UPDATE`, id, companyId);
  if (rows.length === 0) throw new Error("Work order not found");
}

async function event(tx: Tx, ctx: Ctx, workOrderId: string, kind: string, from: WoStatus | null, to: WoStatus | null, note = "") {
  await tx.workOrderEvent.create({
    data: { companyId: ctx.companyId, workOrderId, kind, fromStatus: from, toStatus: to, note: note.slice(0, 1000), actorId: ctx.userId },
    select: { id: true },
  });
}

async function activeMember(tx: Tx, companyId: string, membershipId: string | null, label: string) {
  if (!membershipId) return null;
  const m = await tx.membership.findFirst({ where: { id: membershipId, companyId, status: "ACTIVE" }, select: { id: true, userId: true } });
  if (!m) throw new Error(`Choose an active member of your company as the ${label}`);
  return m;
}

async function activeContractor(tx: Tx, companyId: string, contractorId: string | null) {
  if (!contractorId) return null;
  const c = await tx.contractor.findFirst({ where: { id: contractorId, companyId } });
  if (!c) throw new Error("Contractor not found");
  if (!c.active) throw new Error("That contractor is switched off");
  return c;
}

/** The assignee (by membership), or someone who manages maintenance. */
function assertWorker(ctx: Ctx, assigneeId: string | null) {
  assertCan(ctx, "maintenance.work");
  if (assigneeId !== ctx.membershipId && !can(ctx.role, "maintenance.manage")) {
    throw new Error("Only the assigned officer or a manager can update this work order");
  }
}

// ---------- Contractors ----------

const contractorSchema = z.object({
  name: z.string().trim().min(2, "Enter the contractor's name").max(200),
  trade: z.string().trim().max(100).default(""),
  phone: z.string().trim().max(50).default(""),
  email: z.string().trim().max(200).default(""),
  notes: z.string().trim().max(2000).default(""),
});

export async function createContractor(ctx: Ctx, input: z.input<typeof contractorSchema>) {
  assertCan(ctx, "maintenance.manage");
  const data = contractorSchema.parse(input);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const dup = await tx.contractor.findFirst({ where: { companyId: ctx.companyId, name: data.name }, select: { id: true } });
    if (dup) throw new Error("A contractor with that name already exists");
    const row = await tx.contractor.create({ data: { companyId: ctx.companyId, ...data, createdById: ctx.userId } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "company", entityId: ctx.companyId, action: "contractor.created", detail: { contractorId: row.id, name: data.name } });
    return row;
  });
}

export async function setContractorActive(ctx: Ctx, contractorId: string, active: boolean) {
  assertCan(ctx, "maintenance.manage");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const c = await tx.contractor.findFirst({ where: { id: contractorId, companyId: ctx.companyId } });
    if (!c) throw new Error("Contractor not found");
    await tx.contractor.update({ where: { id: contractorId }, data: { active } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "company", entityId: ctx.companyId, action: active ? "contractor.activated" : "contractor.deactivated", detail: { contractorId } });
  });
}

// ---------- Reporting ----------

const optionalMoney = z.string().trim().optional().transform((v) => (v ? parseNairaToKobo(v) : null));
const optionalDate = z.string().trim().optional().transform((v) => (v ? parseDateOnly(v) : null));

const reportSchema = z.object({
  title: z.string().trim().min(3, "Describe the problem in a few words").max(200),
  description: z.string().trim().max(5000).default(""),
  priority: z.enum(PRIORITIES).default("NORMAL"),
  riskLevel: z.enum(RISKS).default("LOW"),
  safetyRisk: z.boolean().default(false),
  requesterName: z.string().trim().max(200).default(""),
  leaseId: z.string().optional().transform((v) => v || null),
  findingId: z.string().optional().transform((v) => v || null),
  targetDate: optionalDate,
  estimatedCost: optionalMoney,
});

async function newRef(tx: Tx, companyId: string) {
  const year = todayInLagos().getUTCFullYear();
  const n = await nextNumber(tx, companyId, "WO", year);
  return `WO-${year}-${String(n).padStart(4, "0")}`;
}

export async function reportWorkOrder(ctx: Ctx, assetId: string, input: z.input<typeof reportSchema>) {
  assertCan(ctx, "maintenance.request");
  reportSchema.parse(input);
  return withTenant(ctx.companyId, ctx.userId, (tx) => reportWorkOrderInTx(tx, ctx, assetId, input));
}

/** Raise a work order inside a transaction the caller already holds (used when a project defect becomes maintenance). */
export async function reportWorkOrderInTx(tx: Tx, ctx: Ctx, assetId: string, input: z.input<typeof reportSchema>) {
  assertCan(ctx, "maintenance.request");
  const data = reportSchema.parse(input);
  {
    const asset = await tx.asset.findFirst({ where: { id: assetId, companyId: ctx.companyId }, select: { id: true } });
    if (!asset) throw new Error("Asset not found");
    if (data.leaseId) {
      const lease = await tx.lease.findFirst({ where: { id: data.leaseId, companyId: ctx.companyId, assetId }, select: { id: true } });
      if (!lease) throw new Error("That lease does not belong to this asset");
    }
    if (data.findingId) {
      const f = await tx.inspectionFinding.findFirst({ where: { id: data.findingId, companyId: ctx.companyId }, include: { inspection: { select: { assetId: true } } } });
      if (!f || f.inspection.assetId !== assetId) throw new Error("Inspection finding not found for this asset");
      if (f.workOrderId) throw new Error("A work order has already been raised for that finding");
    }
    const ref = await newRef(tx, ctx.companyId);
    const wo = await tx.workOrder.create({
      data: {
        companyId: ctx.companyId, assetId, ref, title: data.title, description: data.description,
        source: data.findingId ? "INSPECTION" : "REQUEST", priority: data.priority, riskLevel: data.riskLevel, safetyRisk: data.safetyRisk,
        requestedById: ctx.userId, requesterName: data.requesterName, leaseId: data.leaseId, targetDate: data.targetDate,
        estimatedCostKobo: data.estimatedCost,
      },
    });
    if (data.findingId) await tx.inspectionFinding.update({ where: { id: data.findingId }, data: { workOrderId: wo.id } });
    await event(tx, ctx, wo.id, "REPORTED", null, "REPORTED", data.findingId ? "Raised from an inspection finding" : "");
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: assetId, action: "work_order.reported",
      detail: { workOrderId: wo.id, ref, priority: data.priority, risk: data.riskLevel, safetyRisk: data.safetyRisk },
    });
    return wo;
  }
}

// ---------- Workflow ----------

const triageSchema = z.object({
  priority: z.enum(PRIORITIES),
  riskLevel: z.enum(RISKS),
  safetyRisk: z.boolean().default(false),
  targetDate: optionalDate,
  estimatedCost: optionalMoney,
  note: z.string().trim().max(1000).default(""),
});

export async function triageWorkOrder(ctx: Ctx, id: string, input: z.input<typeof triageSchema>) {
  assertCan(ctx, "maintenance.manage");
  const data = triageSchema.parse(input);
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await lockWorkOrder(tx, id, ctx.companyId);
    const wo = await tx.workOrder.findUniqueOrThrow({ where: { id } });
    const problem = transitionProblem(wo.status, "TRIAGED", data.priority);
    if (problem) throw new Error(problem);
    await tx.workOrder.update({
      where: { id },
      data: { status: "TRIAGED", priority: data.priority, riskLevel: data.riskLevel, safetyRisk: data.safetyRisk, targetDate: data.targetDate, estimatedCostKobo: data.estimatedCost },
    });
    await event(tx, ctx, id, "TRIAGED", wo.status, "TRIAGED", data.note);
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: wo.assetId, action: "work_order.triaged", detail: { workOrderId: id, ref: wo.ref, priority: data.priority } });
  });
}

/**
 * Approve the cost of a work order. The approver cannot be the person who reported it. For ordinary
 * work this moves it to Approved. An emergency can be approved at any point before it is closed,
 * because urgent repairs must not wait; the approval is still needed before closure.
 */
export async function approveWorkOrder(ctx: Ctx, id: string, input: { approvedCost: string; note?: string }) {
  assertCan(ctx, "maintenance.approve");
  const cost = parseNairaToKobo(z.string().min(1, "Enter the approved cost").parse(input.approvedCost));
  const note = z.string().trim().max(1000).parse(input.note ?? "");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await lockWorkOrder(tx, id, ctx.companyId);
    const wo = await tx.workOrder.findUniqueOrThrow({ where: { id } });
    if (wo.requestedById === ctx.userId) throw new Error("A work order must be approved by someone other than the person who reported it");
    if (wo.status === "CLOSED" || wo.status === "CANCELLED") throw new Error("This work order is already finished");
    let to: WoStatus = wo.status;
    if (wo.status === "TRIAGED") {
      to = "APPROVED";
    } else if (wo.status === "REPORTED" && wo.priority !== "EMERGENCY") {
      throw new Error("Triage this work order before approving it");
    }
    await tx.workOrder.update({ where: { id }, data: { status: to, approvedCostKobo: cost, approvedById: ctx.userId, approvedAt: new Date() } });
    await event(tx, ctx, id, to === wo.status ? "COST_APPROVED" : "APPROVED", wo.status, to, note || `Approved cost ${cost.toString()} kobo`);
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: wo.assetId, action: "work_order.approved", detail: { workOrderId: id, ref: wo.ref, approvedCostKobo: cost.toString() } });
  });
}

const assignSchema = z.object({
  assigneeId: z.string().optional().transform((v) => v || null),
  contractorId: z.string().optional().transform((v) => v || null),
  targetDate: optionalDate,
});

/** Assign an officer, a contractor or both. Ordinary work must be approved first; an emergency need not be. */
export async function assignWorkOrder(ctx: Ctx, id: string, input: z.input<typeof assignSchema>) {
  assertCan(ctx, "maintenance.manage");
  const data = assignSchema.parse(input);
  if (!data.assigneeId && !data.contractorId) throw new Error("Choose an officer, a contractor or both");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await lockWorkOrder(tx, id, ctx.companyId);
    const wo = await tx.workOrder.findUniqueOrThrow({ where: { id } });
    await activeMember(tx, ctx.companyId, data.assigneeId, "assigned officer");
    const contractor = await activeContractor(tx, ctx.companyId, data.contractorId);
    const reassign = wo.status === "ASSIGNED" || wo.status === "IN_PROGRESS" || wo.status === "AWAITING_PARTS" || wo.status === "INSPECTION_REQUIRED";
    if (!reassign) {
      const problem = transitionProblem(wo.status, "ASSIGNED", wo.priority);
      if (problem) throw new Error(wo.status === "REPORTED" || wo.status === "TRIAGED" ? "Approve this work order before assigning it" : problem);
    }
    await tx.workOrder.update({
      where: { id },
      data: { status: reassign ? wo.status : "ASSIGNED", assigneeId: data.assigneeId, contractorId: data.contractorId, ...(data.targetDate ? { targetDate: data.targetDate } : {}) },
    });
    await event(tx, ctx, id, reassign ? "REASSIGNED" : "ASSIGNED", wo.status, reassign ? wo.status : "ASSIGNED", contractor ? `Contractor: ${contractor.name}` : "");
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: wo.assetId, action: "work_order.assigned", detail: { workOrderId: id, ref: wo.ref, contractor: contractor?.name ?? null } });
  });
}

/** Move work through start, awaiting parts, inspection required or back to work. */
export async function setProgress(ctx: Ctx, id: string, to: "IN_PROGRESS" | "AWAITING_PARTS" | "INSPECTION_REQUIRED", noteInput: string) {
  const note = z.string().trim().max(1000).parse(noteInput);
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await lockWorkOrder(tx, id, ctx.companyId);
    const wo = await tx.workOrder.findUniqueOrThrow({ where: { id } });
    assertWorker(ctx, wo.assigneeId);
    if (!wo.assigneeId && !wo.contractorId) throw new Error("Assign an officer or contractor before starting work");
    const problem = transitionProblem(wo.status, to, wo.priority);
    if (problem) throw new Error(problem);
    if ((to === "AWAITING_PARTS" || to === "INSPECTION_REQUIRED") && note.length < 3) throw new Error("Say what is needed");
    await tx.workOrder.update({ where: { id }, data: { status: to, ...(to === "IN_PROGRESS" && !wo.startedAt ? { startedAt: new Date() } : {}) } });
    await event(tx, ctx, id, to, wo.status, to, note);
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: wo.assetId, action: `work_order.${to.toLowerCase()}`, detail: { workOrderId: id, ref: wo.ref, note } });
  });
}

const materialSchema = z.object({
  description: z.string().trim().min(2, "Describe the material").max(200),
  quantity: z.string().trim().regex(/^\d{1,6}$/, "Enter the quantity as a whole number").refine((v) => Number(v) > 0, "The quantity must be more than zero"),
  unit: z.string().trim().max(30).default(""),
  unitCost: z.string().transform((v) => parseNairaToKobo(v)),
});

export async function addMaterial(ctx: Ctx, id: string, input: z.input<typeof materialSchema>) {
  const data = materialSchema.parse(input);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await lockWorkOrder(tx, id, ctx.companyId);
    const wo = await tx.workOrder.findUniqueOrThrow({ where: { id } });
    assertWorker(ctx, wo.assigneeId);
    if (wo.status === "COMPLETED" || wo.status === "CLOSED" || wo.status === "CANCELLED") throw new Error("Materials cannot be changed once the work is completed");
    const m = await tx.workOrderMaterial.create({
      data: { companyId: ctx.companyId, workOrderId: id, description: data.description, quantity: Number(data.quantity), unit: data.unit, unitCostKobo: data.unitCost, recordedById: ctx.userId },
    });
    await event(tx, ctx, id, "MATERIAL_ADDED", wo.status, wo.status, `${data.quantity} ${data.unit} ${data.description}`.trim());
    return m;
  });
}

export async function removeMaterial(ctx: Ctx, id: string, materialId: string) {
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await lockWorkOrder(tx, id, ctx.companyId);
    const wo = await tx.workOrder.findUniqueOrThrow({ where: { id } });
    assertWorker(ctx, wo.assigneeId);
    if (wo.status === "COMPLETED" || wo.status === "CLOSED" || wo.status === "CANCELLED") throw new Error("Materials cannot be changed once the work is completed");
    const m = await tx.workOrderMaterial.findFirst({ where: { id: materialId, workOrderId: id, companyId: ctx.companyId } });
    if (!m) throw new Error("Material not found");
    if (m.inventoryItemId) throw new Error("This material was issued from stock. Record a return in inventory instead.");
    await tx.workOrderMaterial.delete({ where: { id: materialId } });
    await event(tx, ctx, id, "MATERIAL_REMOVED", wo.status, wo.status, m.description);
  });
}

export async function addWorkOrderPhoto(ctx: Ctx, id: string, meta: { phase?: string; caption?: string }, file: Upload) {
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await lockWorkOrder(tx, id, ctx.companyId);
    const wo = await tx.workOrder.findUniqueOrThrow({ where: { id } });
    assertWorker(ctx, wo.assigneeId);
    if (wo.status === "CLOSED" || wo.status === "CANCELLED") throw new Error("This work order is finished");
    return savePhoto(tx, ctx, "work_order", id, meta as never, file);
  });
}

const completeSchema = z.object({
  completedOn: z.string().transform((v) => parseDateOnly(v)),
  notes: z.string().trim().max(5000).default(""),
  evidenceRef: z.string().trim().max(300).default(""),
  actualCost: optionalMoney,
  downtimeFrom: optionalDate,
  downtimeTo: optionalDate,
});

export async function completeWorkOrder(ctx: Ctx, id: string, input: z.input<typeof completeSchema>) {
  const data = completeSchema.parse(input);
  if (data.completedOn > todayInLagos()) throw new Error("The completion date cannot be in the future");
  if (data.downtimeFrom && data.downtimeTo && data.downtimeTo < data.downtimeFrom) throw new Error("Downtime cannot end before it starts");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await lockWorkOrder(tx, id, ctx.companyId);
    const wo = await tx.workOrder.findUniqueOrThrow({ where: { id } });
    assertWorker(ctx, wo.assigneeId);
    const problem = transitionProblem(wo.status, "COMPLETED", wo.priority);
    if (problem) throw new Error(problem);
    const after = await tx.evidencePhoto.count({ where: { companyId: ctx.companyId, subjectType: "work_order", subjectId: id, phase: "AFTER" } });
    const evidenceProblem = completionProblem({ notes: data.notes, hasAfterPhoto: after > 0, evidenceRef: data.evidenceRef });
    if (evidenceProblem) throw new Error(evidenceProblem);
    await tx.workOrder.update({
      where: { id },
      data: {
        status: "COMPLETED", completedOn: data.completedOn, completedById: ctx.userId, completionNotes: data.notes, evidenceRef: data.evidenceRef,
        actualCostKobo: data.actualCost, downtimeFrom: data.downtimeFrom, downtimeTo: data.downtimeTo,
      },
    });
    await event(tx, ctx, id, "COMPLETED", wo.status, "COMPLETED", data.notes);
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: wo.assetId, action: "work_order.completed", detail: { workOrderId: id, ref: wo.ref, actualCostKobo: data.actualCost?.toString() ?? null } });
  });
}

/** Verify the completed work and close the order. The verifier cannot be the person who did or recorded the work. */
export async function closeWorkOrder(ctx: Ctx, id: string, noteInput: string) {
  assertCan(ctx, "maintenance.verify");
  const note = z.string().trim().max(1000).parse(noteInput);
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await lockWorkOrder(tx, id, ctx.companyId);
    const wo = await tx.workOrder.findUniqueOrThrow({ where: { id }, include: { assignee: { select: { userId: true } } } });
    const problem = closureProblem({
      status: wo.status, approvedById: wo.approvedById, approvedCostKobo: wo.approvedCostKobo, actualCostKobo: wo.actualCostKobo,
      completedByUserId: wo.completedById, assigneeUserId: wo.assignee?.userId ?? null, verifierUserId: ctx.userId,
    });
    if (problem) throw new Error(problem);
    await tx.workOrder.update({ where: { id }, data: { status: "CLOSED", verifiedById: ctx.userId, closedAt: new Date() } });
    await event(tx, ctx, id, "CLOSED", "COMPLETED", "CLOSED", note);
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: wo.assetId, action: "work_order.closed", detail: { workOrderId: id, ref: wo.ref } });
  });
}

/** Send completed work back for more work when verification finds a problem. */
export async function reopenWorkOrder(ctx: Ctx, id: string, noteInput: string) {
  assertCan(ctx, "maintenance.verify");
  const note = z.string().trim().min(5, "Say what is still wrong").max(1000).parse(noteInput);
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await lockWorkOrder(tx, id, ctx.companyId);
    const wo = await tx.workOrder.findUniqueOrThrow({ where: { id } });
    if (wo.status !== "COMPLETED") throw new Error("Only completed work can be sent back");
    await tx.workOrder.update({ where: { id }, data: { status: "IN_PROGRESS", completedOn: null, completedById: null } });
    await event(tx, ctx, id, "REOPENED", "COMPLETED", "IN_PROGRESS", note);
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: wo.assetId, action: "work_order.reopened", detail: { workOrderId: id, ref: wo.ref, note } });
  });
}

export async function cancelWorkOrder(ctx: Ctx, id: string, reasonInput: string) {
  assertCan(ctx, "maintenance.manage");
  const reason = z.string().trim().min(5, "Give the reason for cancelling this work order").max(500).parse(reasonInput);
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await lockWorkOrder(tx, id, ctx.companyId);
    const wo = await tx.workOrder.findUniqueOrThrow({ where: { id } });
    const problem = transitionProblem(wo.status, "CANCELLED", wo.priority);
    if (problem) throw new Error(problem);
    await tx.workOrder.update({ where: { id }, data: { status: "CANCELLED", cancelReason: reason } });
    await event(tx, ctx, id, "CANCELLED", wo.status, "CANCELLED", reason);
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: wo.assetId, action: "work_order.cancelled", detail: { workOrderId: id, ref: wo.ref, reason } });
  });
}

// ---------- Preventive schedules ----------

const scheduleSchema = z.object({
  title: z.string().trim().min(3, "Name the recurring job").max(200),
  description: z.string().trim().max(2000).default(""),
  priority: z.enum(PRIORITIES).default("NORMAL"),
  intervalMonths: z.string().trim().regex(/^\d{1,3}$/, "Enter the interval as a whole number of months").refine((v) => Number(v) >= 1 && Number(v) <= 120, "The interval must be between 1 and 120 months"),
  nextDueOn: z.string().transform((v) => parseDateOnly(v)),
  leadDays: z.string().trim().optional().transform((v, ctx): number => {
    if (!v) return 14;
    if (!/^\d{1,3}$/.test(v) || Number(v) > 365) { ctx.addIssue({ code: "custom", message: "Lead time must be between 0 and 365 days" }); return z.NEVER; }
    return Number(v);
  }),
  contractorId: z.string().optional().transform((v) => v || null),
  assigneeId: z.string().optional().transform((v) => v || null),
  estimatedCost: optionalMoney,
});

export async function createSchedule(ctx: Ctx, assetId: string, input: z.input<typeof scheduleSchema>) {
  assertCan(ctx, "maintenance.manage");
  const data = scheduleSchema.parse(input);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const asset = await tx.asset.findFirst({ where: { id: assetId, companyId: ctx.companyId }, select: { id: true } });
    if (!asset) throw new Error("Asset not found");
    await activeMember(tx, ctx.companyId, data.assigneeId, "assigned officer");
    await activeContractor(tx, ctx.companyId, data.contractorId);
    const row = await tx.preventiveSchedule.create({
      data: {
        companyId: ctx.companyId, assetId, title: data.title, description: data.description, priority: data.priority,
        intervalMonths: Number(data.intervalMonths), nextDueOn: data.nextDueOn, leadDays: data.leadDays,
        contractorId: data.contractorId, assigneeId: data.assigneeId, estimatedCostKobo: data.estimatedCost, createdById: ctx.userId,
      },
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: assetId, action: "maintenance.schedule_created", detail: { scheduleId: row.id, title: data.title, everyMonths: Number(data.intervalMonths) } });
    return row;
  });
}

export async function setScheduleActive(ctx: Ctx, scheduleId: string, active: boolean) {
  assertCan(ctx, "maintenance.manage");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const s = await tx.preventiveSchedule.findFirst({ where: { id: scheduleId, companyId: ctx.companyId } });
    if (!s) throw new Error("Schedule not found");
    await tx.preventiveSchedule.update({ where: { id: scheduleId }, data: { active } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: s.assetId, action: active ? "maintenance.schedule_resumed" : "maintenance.schedule_paused", detail: { scheduleId } });
  });
}

/**
 * Create the work orders that are due. Each is created once per schedule and due date (the database
 * enforces this), so running it twice, or at the same moment from two places, never duplicates work.
 */
export async function generateDueWorkOrders(ctx: Ctx): Promise<number> {
  assertCan(ctx, "maintenance.manage");
  const today = todayInLagos();
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await lockKey(tx, `wo-generate:${ctx.companyId}`);
    const schedules = await tx.preventiveSchedule.findMany({ where: { companyId: ctx.companyId, active: true }, orderBy: { nextDueOn: "asc" } });
    let created = 0;
    for (const s of schedules) {
      const due = dueOccurrences(s.nextDueOn, s.intervalMonths, s.leadDays, today, addMonthsClamped);
      if (due.length === 0) continue;
      let next = s.nextDueOn;
      for (const d of due) {
        const exists = await tx.workOrder.findFirst({ where: { scheduleId: s.id, scheduledFor: d }, select: { id: true } });
        if (!exists) {
          const ref = await newRef(tx, ctx.companyId);
          const wo = await tx.workOrder.create({
            data: {
              companyId: ctx.companyId, assetId: s.assetId, ref, title: s.title, description: s.description, source: "PREVENTIVE", priority: s.priority,
              requestedById: s.createdById, scheduleId: s.id, scheduledFor: d, targetDate: d, assigneeId: s.assigneeId, contractorId: s.contractorId,
              estimatedCostKobo: s.estimatedCostKobo,
            },
          });
          await event(tx, ctx, wo.id, "REPORTED", null, "REPORTED", `Preventive maintenance due ${d.toISOString().slice(0, 10)}`);
          created += 1;
        }
        next = addMonthsClamped(d, s.intervalMonths);
      }
      await tx.preventiveSchedule.update({ where: { id: s.id }, data: { nextDueOn: next } });
    }
    if (created > 0) {
      await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "company", entityId: ctx.companyId, action: "maintenance.work_orders_generated", detail: { created } });
    }
    return created;
  });
}

// ---------- Reading ----------

export async function listMaintenance(ctx: Ctx) {
  assertCan(ctx, "asset.view");
  const today = todayInLagos();
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const include = { asset: { select: { id: true, ref: true, name: true } }, contractor: { select: { name: true } } } as const;
    const [open, closed, assets, contractors, members, company] = await Promise.all([
      tx.workOrder.findMany({ where: { companyId: ctx.companyId, status: { in: OPEN_STATUSES } }, orderBy: [{ targetDate: "asc" }, { createdAt: "asc" }], include }),
      tx.workOrder.findMany({ where: { companyId: ctx.companyId, status: { in: ["CLOSED", "CANCELLED"] } }, orderBy: { updatedAt: "desc" }, take: 20, include }),
      tx.asset.findMany({ where: { companyId: ctx.companyId }, select: { id: true, ref: true, name: true }, orderBy: { ref: "asc" } }),
      tx.contractor.findMany({ where: { companyId: ctx.companyId }, orderBy: { name: "asc" } }),
      tx.membership.findMany({ where: { companyId: ctx.companyId, status: "ACTIVE" }, include: { user: { select: { name: true } } } }),
      tx.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { escalationDays: true } }),
    ]);
    const names = Object.fromEntries(members.map((m) => [m.id, m.user.name]));
    const now = new Date();
    const spent = await tx.workOrder.aggregate({
      where: { companyId: ctx.companyId, status: "CLOSED", closedAt: { gte: new Date(Date.UTC(today.getUTCFullYear(), 0, 1)) } },
      _sum: { actualCostKobo: true },
    });
    const unattendedUrgent = open.filter((w) => isUnattendedUrgent({
      priority: w.priority, riskLevel: w.riskLevel, safetyRisk: w.safetyRisk, status: w.status, createdAt: w.createdAt, now, hours: URGENT_UNATTENDED_HOURS,
    })).length;
    return {
      today, open, closed, assets, contractors, names, escalationDays: company.escalationDays,
      spentThisYearKobo: spent._sum.actualCostKobo ?? 0n, unattendedUrgent,
      members: members.map((m) => ({ id: m.id, name: m.user.name })),
      overdue: open.filter((w) => w.targetDate && w.targetDate < today),
    };
  });
}

export async function getWorkOrder(ctx: Ctx, id: string) {
  assertCan(ctx, "asset.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const wo = await tx.workOrder.findFirst({
      where: { id, companyId: ctx.companyId },
      include: {
        asset: { select: { id: true, ref: true, name: true } },
        contractor: true,
        events: { orderBy: { createdAt: "asc" } },
        materials: { orderBy: { createdAt: "asc" } },
        schedule: { select: { id: true, title: true } },
        finding: { select: { id: true, title: true, inspectionId: true } },
        assignee: { select: { userId: true, user: { select: { name: true } } } },
      },
    });
    if (!wo) return null;
    const photos = await photosFor(tx, ctx.companyId, "work_order", [wo.id]);
    const userIds = [wo.requestedById, wo.approvedById, wo.completedById, wo.verifiedById, ...wo.events.map((e) => e.actorId), ...wo.materials.map((m) => m.recordedById)].filter((x): x is string => !!x);
    const users = await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
    const members = await tx.membership.findMany({ where: { companyId: ctx.companyId, status: "ACTIVE" }, include: { user: { select: { name: true } } } });
    const contractors = await tx.contractor.findMany({ where: { companyId: ctx.companyId, active: true }, orderBy: { name: "asc" } });
    // Warranties from completed projects that are in force today, so a repair that may be covered is noticed.
    const today = todayInLagos();
    const warranties = await tx.projectWarranty.findMany({ where: { companyId: ctx.companyId, assetId: wo.assetId, startsOn: { lte: today }, endsOn: { gte: today } }, orderBy: { endsOn: "asc" }, take: 10 });
    return {
      warranties, wo, photos, contractors, materialsTotal: materialsTotal(wo.materials),
      names: Object.fromEntries(users.map((u) => [u.id, u.name])) as Record<string, string>,
      members: members.map((m) => ({ id: m.id, name: m.user.name })),
    };
  });
}

/** Closed and open work on one asset, for its maintenance history. */
export async function assetMaintenance(ctx: Ctx, assetId: string) {
  assertCan(ctx, "asset.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const rows = await tx.workOrder.findMany({
      where: { companyId: ctx.companyId, assetId }, orderBy: { createdAt: "desc" }, take: 30,
      select: { id: true, ref: true, title: true, status: true, priority: true, completedOn: true, actualCostKobo: true, createdAt: true, downtimeFrom: true, downtimeTo: true },
    });
    const downtimeDays = rows.reduce((sum, r) => (r.downtimeFrom && r.downtimeTo ? sum + Math.round((r.downtimeTo.getTime() - r.downtimeFrom.getTime()) / 864e5) + 1 : sum), 0);
    return { rows, downtimeDays };
  });
}

export async function listSchedules(ctx: Ctx) {
  assertCan(ctx, "asset.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const [schedules, assets, contractors, members] = await Promise.all([
      tx.preventiveSchedule.findMany({ where: { companyId: ctx.companyId }, orderBy: { nextDueOn: "asc" }, include: { asset: { select: { id: true, ref: true, name: true } }, contractor: { select: { name: true } } } }),
      tx.asset.findMany({ where: { companyId: ctx.companyId }, select: { id: true, ref: true, name: true }, orderBy: { ref: "asc" } }),
      tx.contractor.findMany({ where: { companyId: ctx.companyId, active: true }, orderBy: { name: "asc" } }),
      tx.membership.findMany({ where: { companyId: ctx.companyId, status: "ACTIVE" }, include: { user: { select: { name: true } } } }),
    ]);
    return { schedules, assets, contractors, members: members.map((m) => ({ id: m.id, name: m.user.name })), names: Object.fromEntries(members.map((m) => [m.id, m.user.name])) };
  });
}

/** Contractors with their open work and the spend on closed work. */
export async function contractorSummary(ctx: Ctx) {
  assertCan(ctx, "asset.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const contractors = await tx.contractor.findMany({ where: { companyId: ctx.companyId }, orderBy: { name: "asc" } });
    const orders = await tx.workOrder.findMany({
      where: { companyId: ctx.companyId, contractorId: { not: null } }, select: { contractorId: true, status: true, actualCostKobo: true },
    });
    return contractors.map((c) => {
      const mine = orders.filter((o) => o.contractorId === c.id);
      return {
        ...c,
        openCount: mine.filter((o) => (OPEN_STATUSES as string[]).includes(o.status)).length,
        spendKobo: mine.filter((o) => o.status === "CLOSED").reduce((s, o) => s + (o.actualCostKobo ?? 0n), 0n),
      };
    });
  });
}
