import { z } from "zod";
import { withTenant, type Tx } from "../db";
import { logActivity } from "../audit";
import { parseNairaToKobo } from "../money";
import { parseDateOnly, todayInLagos } from "../dates";
import { nextNumber } from "../numbering";
import {
  activationProblems, budgetTotal, commitmentProblem, costSummary, extendedEnd, invoiceProblem, normaliseProgress, overallPercent, PROJECT_KINDS,
  scheduleWarnings, WORK_STATUSES, workState, type WorkStatus,
} from "../project-rules";
import { assertCan, type Ctx } from "./context";

// Construction and renovation projects (master prompt Phase 7). A project's budget, each commitment, each
// invoice and each variation is decided by someone other than the person who raised it. Spending is held
// to the approved budget and to each contract sum, and the checks run again, under a lock, at the moment
// of approval.

export { PROJECT_KINDS, WORK_STATUSES };

const date = (label: string) => z.string().trim().min(1, `Enter ${label}`).transform((v) => parseDateOnly(v));
const optionalDate = z.string().trim().optional().transform((v) => (v ? parseDateOnly(v) : null));
const naira = (label: string) => z.string().trim().min(1, `Enter ${label}`).transform((v) => parseNairaToKobo(v));
const optionalNaira = z.string().trim().optional().transform((v) => (v ? parseNairaToKobo(v) : 0n));
const text = (max: number) => z.string().trim().max(max).default("");
const optionalId = z.string().optional().transform((v) => v || null);

const OPEN = ["PLANNING", "ACTIVE", "ON_HOLD"];

async function lockProject(tx: Tx, ctx: Ctx, id: string) {
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM projects WHERE id = $1 AND company_id = $2 FOR UPDATE`, id, ctx.companyId);
  if (rows.length === 0) throw new Error("Project not found");
  return tx.project.findFirstOrThrow({ where: { id, companyId: ctx.companyId } });
}

function needOpen(p: { status: string }) {
  if (!OPEN.includes(p.status)) throw new Error("This project is closed, so it can no longer be changed");
}

function needActive(p: { status: string }) {
  if (p.status !== "ACTIVE") throw new Error("The project must be active. Start it first, or resume it if it is on hold");
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

/** The contract sum of a commitment: its amount plus its approved variations. */
async function contractSums(tx: Tx, companyId: string, projectId: string) {
  const [commitments, variations] = await Promise.all([
    tx.commitment.findMany({ where: { companyId, projectId, status: "APPROVED" } }),
    tx.variation.findMany({ where: { companyId, projectId, status: "APPROVED", target: "COMMITMENT" }, select: { commitmentId: true, amountKobo: true } }),
  ]);
  const map = new Map<string, bigint>();
  for (const c of commitments) map.set(c.id, c.amountKobo);
  for (const v of variations) if (v.commitmentId && map.has(v.commitmentId)) map.set(v.commitmentId, map.get(v.commitmentId)! + v.amountKobo);
  return { commitments, sums: map };
}

async function totalCommitted(tx: Tx, companyId: string, projectId: string) {
  const { sums } = await contractSums(tx, companyId, projectId);
  let total = 0n;
  for (const v of sums.values()) total += v;
  return total;
}

async function invoicedOn(tx: Tx, companyId: string, commitmentId: string, excludeId?: string) {
  const rows = await tx.projectInvoice.findMany({ where: { companyId, commitmentId, status: { in: ["RECEIVED", "APPROVED", "PAID"] }, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { amountKobo: true } });
  return rows.reduce((a, r) => a + r.amountKobo, 0n);
}

// ---------- Projects ----------

const projectSchema = z.object({
  assetId: z.string().min(1, "Choose the asset"),
  title: z.string().trim().min(3, "Give the project a title").max(200),
  kind: z.enum(PROJECT_KINDS),
  description: text(4000),
  managerId: optionalId,
  plannedStart: date("the planned start date"),
  plannedEnd: date("the planned end date"),
  contingency: optionalNaira,
});

export async function createProject(ctx: Ctx, raw: z.input<typeof projectSchema>) {
  assertCan(ctx, "project.manage");
  const d = projectSchema.parse(raw);
  if (d.plannedEnd.getTime() < d.plannedStart.getTime()) throw new Error("The end date cannot be before the start date");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const asset = await tx.asset.findFirst({ where: { id: d.assetId, companyId: ctx.companyId }, select: { id: true } });
    if (!asset) throw new Error("Asset not found");
    await activeMember(tx, ctx.companyId, d.managerId);
    const year = todayInLagos().getUTCFullYear();
    const n = await nextNumber(tx, ctx.companyId, "PRJ", year);
    const ref = `PRJ-${year}-${String(n).padStart(4, "0")}`;
    const p = await tx.project.create({
      data: {
        companyId: ctx.companyId, ref, assetId: d.assetId, title: d.title, kind: d.kind, description: d.description, managerId: d.managerId,
        plannedStart: d.plannedStart, plannedEnd: d.plannedEnd, contingencyKobo: d.contingency, createdById: ctx.userId,
      },
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: p.id, action: "project.created", detail: { ref, kind: d.kind } });
    return p;
  });
}

const updateSchema = z.object({
  title: z.string().trim().min(3, "Give the project a title").max(200),
  description: text(4000),
  managerId: optionalId,
  plannedStart: date("the planned start date"),
  plannedEnd: date("the planned end date"),
  contingency: z.string().trim().optional().transform((v) => (v ? parseNairaToKobo(v) : null)),
});

export async function updateProject(ctx: Ctx, id: string, raw: z.input<typeof updateSchema>) {
  assertCan(ctx, "project.manage");
  const d = updateSchema.parse(raw);
  if (d.plannedEnd.getTime() < d.plannedStart.getTime()) throw new Error("The end date cannot be before the start date");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const p = await lockProject(tx, ctx, id);
    needOpen(p);
    await activeMember(tx, ctx.companyId, d.managerId);
    if (d.contingency !== null && d.contingency !== p.contingencyKobo && p.budgetStatus !== "DRAFT") throw new Error("The contingency is part of the approved budget. Change the budget with a variation");
    await tx.project.update({
      where: { id },
      data: { title: d.title, description: d.description, managerId: d.managerId, plannedStart: d.plannedStart, plannedEnd: d.plannedEnd, ...(d.contingency !== null ? { contingencyKobo: d.contingency } : {}) },
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: id, action: "project.updated", detail: { title: d.title } });
  });
}

export async function activateProject(ctx: Ctx, id: string) {
  assertCan(ctx, "project.manage");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const p = await lockProject(tx, ctx, id);
    if (p.status !== "PLANNING") throw new Error("Only a project in planning can be started");
    const count = await tx.workPackage.count({ where: { companyId: ctx.companyId, projectId: id } });
    const problems = activationProblems({ budgetApproved: p.budgetStatus === "APPROVED", hasManager: !!p.managerId, packageCount: count });
    if (problems.length) throw new Error(`The project cannot start yet: ${problems.join("; ")}.`);
    await tx.project.update({ where: { id }, data: { status: "ACTIVE", actualStart: todayInLagos() } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: id, action: "project.started", detail: {} });
  });
}

export async function holdProject(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "project.manage");
  const why = z.string().trim().min(3, "Say why the project is on hold").max(500).parse(reason);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const p = await lockProject(tx, ctx, id);
    needActive(p);
    await tx.project.update({ where: { id }, data: { status: "ON_HOLD", holdReason: why } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: id, action: "project.held", detail: { reason: why } });
  });
}

export async function resumeProject(ctx: Ctx, id: string) {
  assertCan(ctx, "project.manage");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const p = await lockProject(tx, ctx, id);
    if (p.status !== "ON_HOLD") throw new Error("Only a project on hold can be resumed");
    await tx.project.update({ where: { id }, data: { status: "ACTIVE", holdReason: "" } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: id, action: "project.resumed", detail: {} });
  });
}

export async function cancelProject(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "project.manage");
  const why = z.string().trim().min(3, "Say why the project is being cancelled").max(500).parse(reason);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const p = await lockProject(tx, ctx, id);
    needOpen(p);
    const unpaid = await tx.projectInvoice.count({ where: { companyId: ctx.companyId, projectId: id, status: "APPROVED" } });
    if (unpaid > 0) throw new Error("Pay or reject the approved invoices before cancelling the project");
    const waiting = (await tx.commitment.count({ where: { companyId: ctx.companyId, projectId: id, status: "PENDING" } })) + (await tx.variation.count({ where: { companyId: ctx.companyId, projectId: id, status: "PENDING" } }));
    if (waiting > 0) throw new Error("Decide the commitments and variations that are waiting before cancelling the project");
    await tx.project.update({ where: { id }, data: { status: "CANCELLED", cancelReason: why, actualEnd: todayInLagos() } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: id, action: "project.cancelled", detail: { reason: why } });
  });
}

// ---------- Work packages ----------

const packageSchema = z.object({
  title: z.string().trim().min(3, "Give the work package a title").max(200),
  description: text(2000),
  responsibleId: optionalId,
  contractorId: optionalId,
  plannedStart: date("the planned start date"),
  plannedEnd: date("the planned end date"),
  budget: optionalNaira,
});

async function checkContractor(tx: Tx, companyId: string, contractorId: string | null) {
  if (!contractorId) return;
  const c = await tx.contractor.findFirst({ where: { id: contractorId, companyId }, select: { id: true } });
  if (!c) throw new Error("Contractor not found");
}

export async function addWorkPackage(ctx: Ctx, projectId: string, raw: z.input<typeof packageSchema>) {
  assertCan(ctx, "project.plan");
  const d = packageSchema.parse(raw);
  if (d.plannedEnd.getTime() < d.plannedStart.getTime()) throw new Error("The end date cannot be before the start date");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const p = await lockProject(tx, ctx, projectId);
    needOpen(p);
    if (d.budget > 0n && p.budgetStatus !== "DRAFT") throw new Error("The budget is already submitted. Add funds to a package with a budget variation");
    await activeMember(tx, ctx.companyId, d.responsibleId);
    await checkContractor(tx, ctx.companyId, d.contractorId);
    const last = await tx.workPackage.findFirst({ where: { companyId: ctx.companyId, projectId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
    const order = (last?.sortOrder ?? 0) + 1;
    const w = await tx.workPackage.create({
      data: {
        companyId: ctx.companyId, projectId, code: `WP-${order}`, title: d.title, description: d.description, responsibleId: d.responsibleId, contractorId: d.contractorId,
        plannedStart: d.plannedStart, plannedEnd: d.plannedEnd, budgetKobo: d.budget, sortOrder: order,
      },
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: projectId, action: "project.package_added", detail: { code: w.code, title: d.title } });
    return { workPackage: w, warnings: scheduleWarnings(p, d) };
  });
}

export async function updateWorkPackage(ctx: Ctx, id: string, raw: z.input<typeof packageSchema>) {
  assertCan(ctx, "project.plan");
  const d = packageSchema.parse(raw);
  if (d.plannedEnd.getTime() < d.plannedStart.getTime()) throw new Error("The end date cannot be before the start date");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const w = await tx.workPackage.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!w) throw new Error("Work package not found");
    const p = await lockProject(tx, ctx, w.projectId);
    needOpen(p);
    if (d.budget !== w.budgetKobo && p.budgetStatus !== "DRAFT") throw new Error("The budget is already submitted. Change a package's funds with a budget variation");
    await activeMember(tx, ctx.companyId, d.responsibleId);
    await checkContractor(tx, ctx.companyId, d.contractorId);
    await tx.workPackage.update({
      where: { id },
      data: { title: d.title, description: d.description, responsibleId: d.responsibleId, contractorId: d.contractorId, plannedStart: d.plannedStart, plannedEnd: d.plannedEnd, budgetKobo: d.budget },
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: w.projectId, action: "project.package_updated", detail: { code: w.code } });
    return { projectId: w.projectId, warnings: scheduleWarnings(p, d) };
  });
}

export async function removeWorkPackage(ctx: Ctx, id: string) {
  assertCan(ctx, "project.plan");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const w = await tx.workPackage.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!w) throw new Error("Work package not found");
    const p = await lockProject(tx, ctx, w.projectId);
    needOpen(p);
    if (p.budgetStatus !== "DRAFT") throw new Error("The budget is already submitted, so work packages can no longer be removed");
    const used = (await tx.commitment.count({ where: { companyId: ctx.companyId, workPackageId: id } })) + (await tx.projectForecast.count({ where: { companyId: ctx.companyId, workPackageId: id } }));
    if (used > 0) throw new Error("This work package has commitments or forecasts, so it cannot be removed");
    await tx.workPackage.delete({ where: { id } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: w.projectId, action: "project.package_removed", detail: { code: w.code } });
    return w.projectId;
  });
}

export async function setProgress(ctx: Ctx, id: string, rawStatus: string, rawPercent: string, note = "") {
  assertCan(ctx, "project.plan");
  const status = z.enum(WORK_STATUSES).parse(rawStatus);
  if (!/^\d{1,3}$/.test(rawPercent.trim())) throw new Error("Progress must be a whole number from 0 to 100");
  const wanted = normaliseProgress(status, Number(rawPercent.trim()));
  const why = z.string().trim().max(500).parse(note);
  if (wanted.status === "BLOCKED" && why.length < 3) throw new Error("Say what is blocking the work");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const w = await tx.workPackage.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!w) throw new Error("Work package not found");
    const p = await lockProject(tx, ctx, w.projectId);
    needActive(p);
    const today = todayInLagos();
    await tx.workPackage.update({
      where: { id },
      data: {
        status: wanted.status, percentComplete: wanted.percentComplete,
        actualStart: w.actualStart ?? (wanted.status === "NOT_STARTED" ? null : today),
        actualEnd: wanted.status === "DONE" ? w.actualEnd ?? today : null,
      },
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: w.projectId, action: "project.progress", detail: { code: w.code, status: wanted.status, percent: wanted.percentComplete, note: why } });
    return w.projectId;
  });
}

// ---------- Milestones ----------

export async function addMilestone(ctx: Ctx, projectId: string, raw: { title: string; dueOn: string; workPackageId?: string }) {
  assertCan(ctx, "project.plan");
  const title = z.string().trim().min(3, "Name the milestone").max(200).parse(raw.title);
  const dueOn = parseDateOnly(z.string().trim().min(1, "Enter the due date").parse(raw.dueOn));
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const p = await lockProject(tx, ctx, projectId);
    needOpen(p);
    if (raw.workPackageId) {
      const w = await tx.workPackage.findFirst({ where: { id: raw.workPackageId, companyId: ctx.companyId, projectId }, select: { id: true } });
      if (!w) throw new Error("Work package not found");
    }
    const m = await tx.milestone.create({ data: { companyId: ctx.companyId, projectId, workPackageId: raw.workPackageId || null, title, dueOn } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: projectId, action: "project.milestone_added", detail: { title } });
    return m;
  });
}

export async function achieveMilestone(ctx: Ctx, id: string, achievedOn?: string) {
  assertCan(ctx, "project.plan");
  const on = achievedOn ? parseDateOnly(achievedOn) : todayInLagos();
  if (on.getTime() > todayInLagos().getTime()) throw new Error("A milestone cannot be achieved in the future");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const m = await tx.milestone.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!m) throw new Error("Milestone not found");
    const p = await lockProject(tx, ctx, m.projectId);
    needActive(p);
    if (m.achievedOn) throw new Error("This milestone is already recorded as achieved");
    await tx.milestone.update({ where: { id }, data: { achievedOn: on, achievedById: ctx.userId } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: m.projectId, action: "project.milestone_achieved", detail: { title: m.title } });
    return m.projectId;
  });
}

export async function removeMilestone(ctx: Ctx, id: string) {
  assertCan(ctx, "project.plan");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const m = await tx.milestone.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!m) throw new Error("Milestone not found");
    const p = await lockProject(tx, ctx, m.projectId);
    needOpen(p);
    if (m.achievedOn) throw new Error("An achieved milestone is part of the record and cannot be removed");
    await tx.milestone.delete({ where: { id } });
    return m.projectId;
  });
}

// ---------- Budget approval ----------

export async function submitBudget(ctx: Ctx, projectId: string) {
  assertCan(ctx, "project.plan");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const p = await lockProject(tx, ctx, projectId);
    if (p.status !== "PLANNING") throw new Error("The budget can only be submitted while the project is in planning");
    if (p.budgetStatus !== "DRAFT") throw new Error("The budget has already been submitted");
    const wps = await tx.workPackage.findMany({ where: { companyId: ctx.companyId, projectId }, select: { budgetKobo: true } });
    if (wps.length === 0) throw new Error("Add at least one work package before submitting the budget");
    const total = budgetTotal(wps.map((w) => w.budgetKobo), p.contingencyKobo);
    if (total <= 0n) throw new Error("The budget is empty. Give the work packages budgets");
    await tx.project.update({ where: { id: projectId }, data: { budgetStatus: "SUBMITTED", budgetSubmittedById: ctx.userId, budgetNote: "" } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: projectId, action: "project.budget_submitted", detail: { totalKobo: total.toString() } });
  });
}

export async function decideBudget(ctx: Ctx, projectId: string, decision: "approve" | "reject", note: string) {
  assertCan(ctx, "project.approve");
  const n = z.string().trim().max(1000).parse(note);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const p = await lockProject(tx, ctx, projectId);
    if (p.budgetStatus !== "SUBMITTED") throw new Error("The budget is not waiting for a decision");
    if (p.budgetSubmittedById === ctx.userId) throw new Error("A different person must approve the budget. You submitted it.");
    if (decision === "reject") {
      if (n.length < 3) throw new Error("Say what needs to change");
      await tx.project.update({ where: { id: projectId }, data: { budgetStatus: "DRAFT", budgetDecidedById: ctx.userId, budgetDecidedAt: new Date(), budgetNote: n } });
    } else {
      const wps = await tx.workPackage.findMany({ where: { companyId: ctx.companyId, projectId }, select: { budgetKobo: true } });
      const total = budgetTotal(wps.map((w) => w.budgetKobo), p.contingencyKobo);
      await tx.project.update({ where: { id: projectId }, data: { budgetStatus: "APPROVED", approvedBudgetKobo: total, budgetDecidedById: ctx.userId, budgetDecidedAt: new Date(), budgetNote: n } });
    }
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: projectId, action: decision === "approve" ? "project.budget_approved" : "project.budget_rejected", detail: { note: n } });
  });
}

// ---------- Commitments ----------

const commitmentSchema = z.object({
  supplierName: z.string().trim().max(200).default(""),
  contractorId: optionalId,
  description: z.string().trim().min(3, "Describe what is being bought").max(1000),
  amount: naira("the amount"),
  workPackageId: optionalId,
});

export async function requestCommitment(ctx: Ctx, projectId: string, raw: z.input<typeof commitmentSchema>) {
  assertCan(ctx, "project.cost");
  const d = commitmentSchema.parse(raw);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const p = await lockProject(tx, ctx, projectId);
    needActive(p);
    let supplier = d.supplierName;
    if (d.contractorId) {
      const c = await tx.contractor.findFirst({ where: { id: d.contractorId, companyId: ctx.companyId }, select: { name: true } });
      if (!c) throw new Error("Contractor not found");
      supplier = supplier || c.name;
    }
    if (supplier.length < 2) throw new Error("Enter the supplier or choose a contractor");
    if (d.workPackageId) {
      const w = await tx.workPackage.findFirst({ where: { id: d.workPackageId, companyId: ctx.companyId, projectId }, select: { id: true } });
      if (!w) throw new Error("Work package not found");
    }
    const problem = commitmentProblem({ approvedBudgetKobo: p.approvedBudgetKobo, committedKobo: await totalCommitted(tx, ctx.companyId, projectId), amountKobo: d.amount });
    if (problem) throw new Error(problem);
    const year = todayInLagos().getUTCFullYear();
    const n = await nextNumber(tx, ctx.companyId, "CMT", year);
    const c = await tx.commitment.create({
      data: {
        companyId: ctx.companyId, projectId, workPackageId: d.workPackageId, ref: `CMT-${year}-${String(n).padStart(4, "0")}`, supplierName: supplier,
        contractorId: d.contractorId, description: d.description, amountKobo: d.amount, requestedById: ctx.userId,
      },
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: projectId, action: "project.commitment_requested", detail: { ref: c.ref, amountKobo: d.amount.toString() } });
    return c;
  });
}

export async function decideCommitment(ctx: Ctx, id: string, decision: "approve" | "reject", note: string) {
  assertCan(ctx, "project.approve");
  const n = z.string().trim().max(1000).parse(note);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const c = await tx.commitment.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!c) throw new Error("Commitment not found");
    const p = await lockProject(tx, ctx, c.projectId);
    const fresh = await tx.commitment.findFirstOrThrow({ where: { id, companyId: ctx.companyId } });
    if (fresh.status !== "PENDING") throw new Error("This commitment has already been decided");
    if (fresh.requestedById === ctx.userId) throw new Error("A different person must approve this. You requested it.");
    if (decision === "reject") {
      if (n.length < 3) throw new Error("Say why it is being rejected");
    } else {
      needActive(p);
      const problem = commitmentProblem({ approvedBudgetKobo: p.approvedBudgetKobo, committedKobo: await totalCommitted(tx, ctx.companyId, c.projectId), amountKobo: fresh.amountKobo });
      if (problem) throw new Error(problem);
    }
    await tx.commitment.update({ where: { id }, data: { status: decision === "approve" ? "APPROVED" : "REJECTED", decidedById: ctx.userId, decidedAt: new Date(), decisionNote: n } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: c.projectId, action: decision === "approve" ? "project.commitment_approved" : "project.commitment_rejected", detail: { ref: c.ref, note: n } });
    return c.projectId;
  });
}

// ---------- Invoices ----------

const invoiceSchema = z.object({
  invoiceNo: z.string().trim().min(1, "Enter the invoice number").max(100),
  invoiceDate: date("the invoice date"),
  dueDate: optionalDate,
  amount: naira("the invoice amount"),
});

export async function recordInvoice(ctx: Ctx, commitmentId: string, raw: z.input<typeof invoiceSchema>) {
  assertCan(ctx, "project.cost");
  const d = invoiceSchema.parse(raw);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const c = await tx.commitment.findFirst({ where: { id: commitmentId, companyId: ctx.companyId } });
    if (!c) throw new Error("Commitment not found");
    const p = await lockProject(tx, ctx, c.projectId);
    if (p.status !== "ACTIVE" && p.status !== "ON_HOLD") throw new Error("Invoices can only be recorded on an active project");
    if (c.status !== "APPROVED") throw new Error("Invoices can only be recorded against an approved commitment");
    if (d.invoiceDate.getTime() > todayInLagos().getTime()) throw new Error("The invoice date cannot be in the future");
    const dup = await tx.projectInvoice.findFirst({ where: { companyId: ctx.companyId, commitmentId, invoiceNo: d.invoiceNo }, select: { id: true } });
    if (dup) throw new Error("That invoice number is already recorded for this commitment");
    const { sums } = await contractSums(tx, ctx.companyId, c.projectId);
    const problem = invoiceProblem({ contractKobo: sums.get(commitmentId) ?? c.amountKobo, invoicedSoFarKobo: await invoicedOn(tx, ctx.companyId, commitmentId), amountKobo: d.amount });
    if (problem) throw new Error(problem);
    const inv = await tx.projectInvoice.create({
      data: { companyId: ctx.companyId, projectId: c.projectId, commitmentId, invoiceNo: d.invoiceNo, invoiceDate: d.invoiceDate, dueDate: d.dueDate, amountKobo: d.amount, recordedById: ctx.userId },
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: c.projectId, action: "project.invoice_recorded", detail: { invoiceNo: d.invoiceNo, amountKobo: d.amount.toString() } });
    return inv;
  });
}

export async function decideInvoice(ctx: Ctx, id: string, decision: "approve" | "reject", note: string) {
  assertCan(ctx, "project.approve");
  const n = z.string().trim().max(1000).parse(note);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const inv = await tx.projectInvoice.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!inv) throw new Error("Invoice not found");
    await lockProject(tx, ctx, inv.projectId);
    const fresh = await tx.projectInvoice.findFirstOrThrow({ where: { id, companyId: ctx.companyId } });
    if (fresh.status !== "RECEIVED") throw new Error("This invoice has already been decided");
    if (fresh.recordedById === ctx.userId) throw new Error("A different person must approve this. You recorded it.");
    if (decision === "reject") {
      if (n.length < 3) throw new Error("Say why it is being rejected");
    } else {
      const { sums } = await contractSums(tx, ctx.companyId, inv.projectId);
      const problem = invoiceProblem({ contractKobo: sums.get(inv.commitmentId) ?? 0n, invoicedSoFarKobo: await invoicedOn(tx, ctx.companyId, inv.commitmentId, id), amountKobo: fresh.amountKobo });
      if (problem) throw new Error(problem);
    }
    await tx.projectInvoice.update({ where: { id }, data: { status: decision === "approve" ? "APPROVED" : "REJECTED", decidedById: ctx.userId, decidedAt: new Date(), decisionNote: n } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: inv.projectId, action: decision === "approve" ? "project.invoice_approved" : "project.invoice_rejected", detail: { invoiceNo: inv.invoiceNo, note: n } });
    return inv.projectId;
  });
}

export async function markInvoicePaid(ctx: Ctx, id: string, paidOn?: string) {
  assertCan(ctx, "project.approve");
  const on = paidOn ? parseDateOnly(paidOn) : todayInLagos();
  if (on.getTime() > todayInLagos().getTime()) throw new Error("The payment date cannot be in the future");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const inv = await tx.projectInvoice.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!inv) throw new Error("Invoice not found");
    await lockProject(tx, ctx, inv.projectId);
    const fresh = await tx.projectInvoice.findFirstOrThrow({ where: { id, companyId: ctx.companyId } });
    if (fresh.status !== "APPROVED") throw new Error("Only an approved invoice can be marked as paid");
    await tx.projectInvoice.update({ where: { id }, data: { status: "PAID", paidOn: on, paidById: ctx.userId } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: inv.projectId, action: "project.invoice_paid", detail: { invoiceNo: inv.invoiceNo, amountKobo: inv.amountKobo.toString() } });
    return inv.projectId;
  });
}

// ---------- Variations ----------

const variationSchema = z.object({
  target: z.enum(["COMMITMENT", "BUDGET"]),
  commitmentId: optionalId,
  workPackageId: optionalId,
  title: z.string().trim().min(3, "Give the variation a title").max(200),
  reason: z.string().trim().min(5, "Explain why the change is needed").max(2000),
  amount: z.string().trim().min(1, "Enter the amount").transform((v) => {
    const neg = /^-|^\(/.test(v.trim());
    const kobo = parseNairaToKobo(v.replace(/^[-(]\s*/, "").replace(/\)$/, ""));
    return neg ? -kobo : kobo;
  }),
  timeImpactDays: z.string().trim().optional().transform((v, c): number => {
    if (!v) return 0;
    if (!/^\d{1,4}$/.test(v)) { c.addIssue({ code: z.ZodIssueCode.custom, message: "Extra days must be a whole number" }); return z.NEVER; }
    return Number(v);
  }),
});

export async function requestVariation(ctx: Ctx, projectId: string, raw: z.input<typeof variationSchema>) {
  assertCan(ctx, "project.cost");
  const d = variationSchema.parse(raw);
  if (d.amount === 0n) throw new Error("A variation must change the amount. Enter a figure above or below zero");
  if (d.target === "COMMITMENT" && !d.commitmentId) throw new Error("Choose the commitment this variation changes");
  if (d.target === "BUDGET" && d.commitmentId) throw new Error("A budget variation does not name a commitment");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const p = await lockProject(tx, ctx, projectId);
    needActive(p);
    if (d.commitmentId) {
      const c = await tx.commitment.findFirst({ where: { id: d.commitmentId, companyId: ctx.companyId, projectId, status: "APPROVED" }, select: { id: true } });
      if (!c) throw new Error("Choose an approved commitment on this project");
    }
    if (d.workPackageId) {
      const w = await tx.workPackage.findFirst({ where: { id: d.workPackageId, companyId: ctx.companyId, projectId }, select: { id: true } });
      if (!w) throw new Error("Work package not found");
    }
    const year = todayInLagos().getUTCFullYear();
    const n = await nextNumber(tx, ctx.companyId, "VAR", year);
    const v = await tx.variation.create({
      data: {
        companyId: ctx.companyId, projectId, ref: `VAR-${year}-${String(n).padStart(4, "0")}`, target: d.target, commitmentId: d.commitmentId, workPackageId: d.workPackageId,
        title: d.title, reason: d.reason, amountKobo: d.amount, timeImpactDays: d.timeImpactDays, requestedById: ctx.userId,
      },
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: projectId, action: "project.variation_requested", detail: { ref: v.ref, target: d.target, amountKobo: d.amount.toString(), days: d.timeImpactDays } });
    return v;
  });
}

export async function decideVariation(ctx: Ctx, id: string, decision: "approve" | "reject", note: string) {
  assertCan(ctx, "project.approve");
  const n = z.string().trim().max(1000).parse(note);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const v = await tx.variation.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!v) throw new Error("Variation not found");
    const p = await lockProject(tx, ctx, v.projectId);
    const fresh = await tx.variation.findFirstOrThrow({ where: { id, companyId: ctx.companyId } });
    if (fresh.status !== "PENDING") throw new Error("This variation has already been decided");
    if (fresh.requestedById === ctx.userId) throw new Error("A different person must approve this. You requested it.");
    if (decision === "reject") {
      if (n.length < 3) throw new Error("Say why it is being rejected");
    } else {
      needActive(p);
      if (fresh.target === "COMMITMENT") {
        const { sums } = await contractSums(tx, ctx.companyId, v.projectId);
        const contract = sums.get(fresh.commitmentId!) ?? 0n;
        const invoiced = await invoicedOn(tx, ctx.companyId, fresh.commitmentId!);
        if (contract + fresh.amountKobo < invoiced) throw new Error("This reduction would take the contract sum below what has already been invoiced");
        if (contract + fresh.amountKobo <= 0n) throw new Error("A variation cannot reduce a contract to nothing. Reject or cancel the commitment instead");
        if (fresh.amountKobo > 0n) {
          const problem = commitmentProblem({ approvedBudgetKobo: p.approvedBudgetKobo, committedKobo: await totalCommitted(tx, ctx.companyId, v.projectId), amountKobo: fresh.amountKobo });
          if (problem) throw new Error(problem);
        }
      } else {
        const newBudget = (p.approvedBudgetKobo ?? 0n) + fresh.amountKobo;
        if (newBudget < (await totalCommitted(tx, ctx.companyId, v.projectId))) throw new Error("This reduction would take the budget below what is already committed");
        if (fresh.workPackageId) {
          const w = await tx.workPackage.findFirstOrThrow({ where: { id: fresh.workPackageId, companyId: ctx.companyId } });
          if (w.budgetKobo + fresh.amountKobo < 0n) throw new Error("This reduction is larger than the work package's budget");
          await tx.workPackage.update({ where: { id: w.id }, data: { budgetKobo: w.budgetKobo + fresh.amountKobo } });
        }
        await tx.project.update({ where: { id: v.projectId }, data: { approvedBudgetKobo: newBudget } });
      }
      if (fresh.timeImpactDays > 0) await tx.project.update({ where: { id: v.projectId }, data: { plannedEnd: extendedEnd(p.plannedEnd, fresh.timeImpactDays) } });
    }
    await tx.variation.update({ where: { id }, data: { status: decision === "approve" ? "APPROVED" : "REJECTED", decidedById: ctx.userId, decidedAt: new Date(), decisionNote: n } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: v.projectId, action: decision === "approve" ? "project.variation_approved" : "project.variation_rejected", detail: { ref: v.ref, note: n } });
    return v.projectId;
  });
}

// ---------- Forecast ----------

export async function recordForecast(ctx: Ctx, workPackageId: string, etc: string, note = "") {
  assertCan(ctx, "project.cost");
  const kobo = parseNairaToKobo(z.string().trim().min(1, "Enter the estimate to complete").parse(etc));
  const why = z.string().trim().max(500).parse(note);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const w = await tx.workPackage.findFirst({ where: { id: workPackageId, companyId: ctx.companyId } });
    if (!w) throw new Error("Work package not found");
    const p = await lockProject(tx, ctx, w.projectId);
    if (p.status !== "ACTIVE" && p.status !== "ON_HOLD") throw new Error("Forecasts are recorded on an active project");
    await tx.projectForecast.create({ data: { companyId: ctx.companyId, projectId: w.projectId, workPackageId, etcKobo: kobo, note: why, recordedById: ctx.userId } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "project", entityId: w.projectId, action: "project.forecast", detail: { code: w.code, etcKobo: kobo.toString() } });
    return w.projectId;
  });
}

// ---------- Reading ----------

export async function loadCostSummary(tx: Tx, companyId: string, projectId: string) {
  const p = await tx.project.findFirstOrThrow({ where: { id: projectId, companyId } });
  const [packages, { commitments, sums }, invoices, forecasts] = await Promise.all([
    tx.workPackage.findMany({ where: { companyId, projectId }, orderBy: { sortOrder: "asc" } }),
    contractSums(tx, companyId, projectId),
    tx.projectInvoice.findMany({ where: { companyId, projectId, status: { in: ["APPROVED", "PAID"] } }, include: { commitment: { select: { workPackageId: true } } } }),
    tx.projectForecast.findMany({ where: { companyId, projectId }, orderBy: { createdAt: "desc" } }),
  ]);
  const latest = new Map<string, bigint>();
  for (const f of forecasts) if (!latest.has(f.workPackageId)) latest.set(f.workPackageId, f.etcKobo);
  const summary = costSummary({
    approvedBudgetKobo: p.approvedBudgetKobo, contingencyKobo: p.contingencyKobo, packages: packages.map((w) => ({ id: w.id, budgetKobo: w.budgetKobo })),
    commitments: commitments.map((c) => ({ workPackageId: c.workPackageId, contractKobo: sums.get(c.id) ?? c.amountKobo })),
    invoices: invoices.map((i) => ({ workPackageId: i.commitment.workPackageId, amountKobo: i.amountKobo, paid: i.status === "PAID" })),
    forecasts: [...latest.entries()].map(([workPackageId, etcKobo]) => ({ workPackageId, etcKobo })),
  });
  return { summary, sums };
}

export async function listProjects(ctx: Ctx) {
  assertCan(ctx, "project.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const [projects, assets, members] = await Promise.all([
      tx.project.findMany({ where: { companyId: ctx.companyId }, orderBy: { createdAt: "desc" }, take: 300, include: { asset: { select: { id: true, ref: true, name: true } }, workPackages: true } }),
      tx.asset.findMany({ where: { companyId: ctx.companyId }, select: { id: true, ref: true, name: true }, orderBy: { ref: "asc" } }),
      tx.membership.findMany({ where: { companyId: ctx.companyId, status: "ACTIVE" }, include: { user: { select: { name: true } } } }),
    ]);
    const today = todayInLagos();
    const rows = await Promise.all(projects.map(async (p) => {
      const cost = p.status === "PLANNING" || p.status === "CANCELLED" ? null : (await loadCostSummary(tx, ctx.companyId, p.id)).summary;
      const late = p.workPackages.filter((w) => ["LATE", "BEHIND"].includes(workState(w, today))).length;
      return { project: p, progress: overallPercent(p.workPackages), cost, late };
    }));
    return { rows, assets, members: members.map((m) => ({ id: m.id, name: m.user.name })) };
  });
}

export async function getProject(ctx: Ctx, id: string) {
  assertCan(ctx, "project.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const project = await tx.project.findFirst({ where: { id, companyId: ctx.companyId }, include: { asset: { select: { id: true, ref: true, name: true } } } });
    if (!project) return null;
    const [packages, milestones, commitments, invoices, variations, forecasts, members, contractors, cost] = await Promise.all([
      tx.workPackage.findMany({ where: { companyId: ctx.companyId, projectId: id }, orderBy: { sortOrder: "asc" } }),
      tx.milestone.findMany({ where: { companyId: ctx.companyId, projectId: id }, orderBy: { dueOn: "asc" } }),
      tx.commitment.findMany({ where: { companyId: ctx.companyId, projectId: id }, orderBy: { createdAt: "desc" } }),
      tx.projectInvoice.findMany({ where: { companyId: ctx.companyId, projectId: id }, orderBy: { createdAt: "desc" }, include: { commitment: { select: { ref: true, supplierName: true } } } }),
      tx.variation.findMany({ where: { companyId: ctx.companyId, projectId: id }, orderBy: { createdAt: "desc" } }),
      tx.projectForecast.findMany({ where: { companyId: ctx.companyId, projectId: id }, orderBy: { createdAt: "desc" }, take: 100 }),
      tx.membership.findMany({ where: { companyId: ctx.companyId, status: "ACTIVE" }, include: { user: { select: { name: true } } } }),
      tx.contractor.findMany({ where: { companyId: ctx.companyId, active: true }, select: { id: true, name: true, trade: true }, orderBy: { name: "asc" } }),
      loadCostSummary(tx, ctx.companyId, id),
    ]);
    const names = await nameMap(tx, [
      project.budgetSubmittedById, project.budgetDecidedById, ...commitments.flatMap((c) => [c.requestedById, c.decidedById]),
      ...invoices.flatMap((i) => [i.recordedById, i.decidedById, i.paidById]), ...variations.flatMap((v) => [v.requestedById, v.decidedById]),
      ...milestones.map((m) => m.achievedById), ...forecasts.map((f) => f.recordedById),
    ]);
    const today = todayInLagos();
    return {
      project, packages, milestones, commitments, invoices, variations, forecasts, names, contractors,
      members: members.map((m) => ({ id: m.id, name: m.user.name })), cost: cost.summary, contractSums: Object.fromEntries(cost.sums),
      states: Object.fromEntries(packages.map((w) => [w.id, workState(w, today)])), progress: overallPercent(packages),
      lateMilestones: milestones.filter((m) => !m.achievedOn && m.dueOn.getTime() < today.getTime()).length,
    };
  });
}

export type ProjectView = NonNullable<Awaited<ReturnType<typeof getProject>>>;
export type { WorkStatus };
