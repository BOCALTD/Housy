import { z } from "zod";
import { withTenant, type Tx } from "../db";
import { logActivity } from "../audit";
import { parseNairaToKobo } from "../money";
import { parseDateOnly, todayInLagos } from "../dates";
import { allocateBudget, assessmentBalance, evidenceKey, fundPosition } from "../ledger-rules";
import { lockKey } from "../locks";
import { assertCan, type Ctx } from "./context";

// Service charge budgets, assessments, collections, expenses and the fund (master prompt Section 13.1).

export const SERVICE_METHODS = ["EQUAL", "FLOOR_AREA", "FIXED"] as const;

async function lockRow(tx: Tx, table: "service_charge_periods" | "service_assessments" | "service_expenses", id: string, companyId: string) {
  // Table names come from the fixed list above, never from input.
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM ${table} WHERE id = $1 AND company_id = $2 FOR UPDATE`, id, companyId);
  return rows.length > 0;
}

const periodSchema = z.object({
  name: z.string().trim().min(2, "Name the service charge period").max(120),
  startDate: z.string().transform((v) => parseDateOnly(v)),
  endDate: z.string().transform((v) => parseDateOnly(v)),
  budget: z.string().transform((v) => parseNairaToKobo(v)),
  method: z.enum(SERVICE_METHODS),
});

export async function createServicePeriod(ctx: Ctx, assetId: string, input: z.input<typeof periodSchema>) {
  assertCan(ctx, "service.manage");
  const data = periodSchema.parse(input);
  if (data.endDate <= data.startDate) throw new Error("The period must end after it starts");
  if (data.budget <= 0n) throw new Error("The budget must be more than zero");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const asset = await tx.asset.findFirst({ where: { id: assetId, companyId: ctx.companyId } });
    if (!asset) throw new Error("Asset not found");
    const period = await tx.serviceChargePeriod.create({
      data: {
        companyId: ctx.companyId, assetId, name: data.name, startDate: data.startDate, endDate: data.endDate,
        budgetKobo: data.budget, method: data.method, createdById: ctx.userId,
      },
    });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: assetId, action: "service_charge.period_created",
      detail: { periodId: period.id, name: data.name, budgetKobo: data.budget.toString(), method: data.method },
    });
    return period;
  });
}

const assessSchema = z.object({
  dueDate: z.string().transform((v) => parseDateOnly(v)),
  /** For the fixed method: an amount in naira per lease id. */
  fixed: z.record(z.string(), z.string()).default({}),
});

/**
 * Share the budget between the property's active leases and create each tenant's assessment. This
 * can be done once per period; the shares add up to the budget exactly.
 */
export async function assessPeriod(ctx: Ctx, periodId: string, input: z.input<typeof assessSchema>) {
  assertCan(ctx, "service.manage");
  const data = assessSchema.parse(input);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    if (!(await lockRow(tx, "service_charge_periods", periodId, ctx.companyId))) throw new Error("Service charge period not found");
    const period = await tx.serviceChargePeriod.findUniqueOrThrow({ where: { id: periodId } });
    if (period.status !== "OPEN") throw new Error("This period has already been assessed");
    const leases = await tx.lease.findMany({
      where: { companyId: ctx.companyId, assetId: period.assetId, status: "ACTIVE", startDate: { lte: period.endDate }, endDate: { gte: period.startDate } },
      orderBy: { ref: "asc" },
    });
    const shares = allocateBudget(period.budgetKobo, period.method, leases.map((l) => ({
      id: l.id,
      floorAreaSqm: l.floorAreaSqm,
      ...(period.method === "FIXED" ? { fixedKobo: data.fixed[l.id] === undefined || data.fixed[l.id] === "" ? undefined : parseNairaToKobo(data.fixed[l.id]) } : {}),
    })));
    await tx.serviceAssessment.createMany({
      data: shares.map((s) => ({ companyId: ctx.companyId, periodId, leaseId: s.id, amountKobo: s.amountKobo, dueDate: data.dueDate })),
    });
    await tx.serviceChargePeriod.update({ where: { id: periodId }, data: { status: "ASSESSED", assessedAt: new Date() } });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: period.assetId, action: "service_charge.assessed",
      detail: { periodId, leases: shares.length, budgetKobo: period.budgetKobo.toString() },
    });
    return shares;
  });
}

const collectionSchema = z.object({
  amount: z.string().transform((v) => parseNairaToKobo(v)),
  paidOn: z.string().transform((v) => parseDateOnly(v)),
  evidence: z.string().trim().min(3, "Record the payment evidence, for example a bank transfer reference").max(500),
  method: z.string().trim().max(40).default(""),
});

/** Record money received against a tenant's service charge. Part payments are fine; overpaying is not. */
export async function recordCollection(ctx: Ctx, assessmentId: string, input: z.input<typeof collectionSchema>) {
  assertCan(ctx, "service.collect");
  const data = collectionSchema.parse(input);
  if (data.amount <= 0n) throw new Error("The amount must be more than zero");
  if (data.paidOn > todayInLagos()) throw new Error("The payment date cannot be in the future");
  const key = evidenceKey(data.evidence);
  if (key.length < 3) throw new Error("Record the payment evidence: a reference with at least 3 letters or digits");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    if (!(await lockRow(tx, "service_assessments", assessmentId, ctx.companyId))) throw new Error("Assessment not found");
    await lockKey(tx, `service-evidence:${ctx.companyId}:${key}`);
    const assessment = await tx.serviceAssessment.findUniqueOrThrow({
      where: { id: assessmentId }, include: { collections: { include: { reversal: true } } },
    });
    const { outstanding } = assessmentBalance(assessment.amountKobo, assessment.collections.map((c) => ({ amountKobo: c.amountKobo, reversed: !!c.reversal })));
    if (outstanding <= 0n) throw new Error("This service charge is already fully paid");
    if (data.amount > outstanding) throw new Error("Payment is more than the amount outstanding on this service charge");
    const duplicate = await tx.serviceCollection.findFirst({
      where: { companyId: ctx.companyId, evidenceKey: key, reversal: { is: null } }, select: { id: true },
    });
    if (duplicate) throw new Error("That evidence reference is already recorded against a service charge payment.");
    const collection = await tx.serviceCollection.create({
      data: {
        companyId: ctx.companyId, assessmentId, amountKobo: data.amount, paidOn: data.paidOn, method: data.method,
        evidence: data.evidence, evidenceKey: key, recordedById: ctx.userId,
      },
    });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "lease", entityId: assessment.leaseId, action: "service_charge.collected",
      detail: { assessmentId, collectionId: collection.id, amountKobo: data.amount.toString(), evidence: data.evidence },
    });
    return collection;
  });
}

export async function reverseCollection(ctx: Ctx, collectionId: string, reasonInput: string) {
  assertCan(ctx, "payment.reverse");
  const reason = z.string().trim().min(5, "Give the reason for reversing this payment").max(500).parse(reasonInput);
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    // Collections are append-only (no row lock available), so serialise reversals with an advisory lock.
    await lockKey(tx, `service-collection:${collectionId}`);
    const collection = await tx.serviceCollection.findFirst({
      where: { id: collectionId, companyId: ctx.companyId }, include: { reversal: true, assessment: true },
    });
    if (!collection) throw new Error("Payment not found");
    if (collection.reversal) throw new Error("This payment has already been reversed");
    await tx.serviceCollectionReversal.create({ data: { companyId: ctx.companyId, collectionId, reason, reversedById: ctx.userId } });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "lease", entityId: collection.assessment.leaseId,
      action: "service_charge.collection_reversed", detail: { collectionId, amountKobo: collection.amountKobo.toString(), reason },
    });
  });
}

const expenseSchema = z.object({
  description: z.string().trim().min(3, "Describe what was spent").max(300),
  supplier: z.string().trim().max(200).default(""),
  amount: z.string().transform((v) => parseNairaToKobo(v)),
  incurredOn: z.string().transform((v) => parseDateOnly(v)),
  evidence: z.string().trim().min(3, "Record the invoice or receipt reference").max(500),
});

export async function requestExpense(ctx: Ctx, periodId: string, input: z.input<typeof expenseSchema>) {
  assertCan(ctx, "service.expense");
  const data = expenseSchema.parse(input);
  if (data.amount <= 0n) throw new Error("The amount must be more than zero");
  if (data.incurredOn > todayInLagos()) throw new Error("The expense date cannot be in the future");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const period = await tx.serviceChargePeriod.findFirst({ where: { id: periodId, companyId: ctx.companyId } });
    if (!period) throw new Error("Service charge period not found");
    const expense = await tx.serviceExpense.create({
      data: {
        companyId: ctx.companyId, periodId, description: data.description, supplier: data.supplier, amountKobo: data.amount,
        incurredOn: data.incurredOn, evidence: data.evidence, requestedById: ctx.userId,
      },
    });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: period.assetId, action: "service_charge.expense_requested",
      detail: { periodId, expenseId: expense.id, amountKobo: data.amount.toString() },
    });
    return expense;
  });
}

/** Approve or reject an expense. Approval needs someone other than the requester, and enough money in the fund. */
export async function decideExpense(ctx: Ctx, expenseId: string, decision: "approve" | "reject", noteInput: string) {
  const note = z.string().trim().max(500).parse(noteInput);
  if (decision === "approve") assertCan(ctx, "service.approve"); else assertCan(ctx, "service.expense");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const found = await tx.serviceExpense.findFirst({ where: { id: expenseId, companyId: ctx.companyId }, select: { periodId: true } });
    if (!found) throw new Error("Expense not found");
    // Lock the period so two approvals cannot together spend more than the fund holds.
    await lockRow(tx, "service_charge_periods", found.periodId, ctx.companyId);
    const expense = await tx.serviceExpense.findUniqueOrThrow({ where: { id: expenseId }, include: { period: true } });
    if (expense.status !== "PENDING") throw new Error("This expense has already been decided");
    if (decision === "approve") {
      if (expense.requestedById === ctx.userId) throw new Error("An expense must be approved by someone other than the person who requested it");
      const position = await periodPosition(tx, ctx.companyId, expense.periodId);
      if (expense.amountKobo > position.balance) {
        throw new Error("The service charge fund does not hold enough to cover this expense. Collect more before approving it.");
      }
    }
    await tx.serviceExpense.update({
      where: { id: expenseId },
      data: { status: decision === "approve" ? "APPROVED" : "REJECTED", decidedById: ctx.userId, decidedAt: new Date(), decisionNote: note },
    });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: expense.period.assetId,
      action: decision === "approve" ? "service_charge.expense_approved" : "service_charge.expense_rejected",
      detail: { expenseId, amountKobo: expense.amountKobo.toString(), note },
    });
  });
}

/** Totals for one period, worked out from the records every time (nothing is stored that could drift). */
async function periodPosition(tx: Tx, companyId: string, periodId: string) {
  const period = await tx.serviceChargePeriod.findFirstOrThrow({
    where: { id: periodId, companyId },
    include: {
      assessments: { include: { collections: { include: { reversal: true } } } },
      expenses: true,
    },
  });
  let assessed = 0n, collected = 0n;
  for (const a of period.assessments) {
    assessed += a.amountKobo;
    collected += assessmentBalance(a.amountKobo, a.collections.map((c) => ({ amountKobo: c.amountKobo, reversed: !!c.reversal }))).collected;
  }
  const sum = (status: string) => period.expenses.filter((e) => e.status === status).reduce((s, e) => s + e.amountKobo, 0n);
  const fund = fundPosition({ collectedKobo: collected, approvedExpensesKobo: sum("APPROVED"), pendingExpensesKobo: sum("PENDING"), budgetKobo: period.budgetKobo });
  return { period, assessed, collected, outstanding: assessed - collected, approvedExpenses: sum("APPROVED"), pendingExpenses: sum("PENDING"), ...fund };
}

export async function listServicePeriods(ctx: Ctx) {
  assertCan(ctx, "finance.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const periods = await tx.serviceChargePeriod.findMany({
      where: { companyId: ctx.companyId }, orderBy: { startDate: "desc" }, include: { asset: { select: { id: true, ref: true, name: true } } },
    });
    const rows = [];
    for (const p of periods) rows.push({ asset: p.asset, ...(await periodPosition(tx, ctx.companyId, p.id)) });
    const assets = await tx.asset.findMany({ where: { companyId: ctx.companyId }, select: { id: true, ref: true, name: true }, orderBy: { ref: "asc" } });
    return { rows, assets };
  });
}

export async function getServicePeriod(ctx: Ctx, periodId: string) {
  assertCan(ctx, "finance.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const exists = await tx.serviceChargePeriod.findFirst({ where: { id: periodId, companyId: ctx.companyId }, select: { id: true } });
    if (!exists) return null;
    const position = await periodPosition(tx, ctx.companyId, periodId);
    const asset = await tx.asset.findUniqueOrThrow({ where: { id: position.period.assetId }, select: { id: true, ref: true, name: true } });
    const leaseIds = position.period.assessments.map((a) => a.leaseId);
    const leases = await tx.lease.findMany({ where: { id: { in: leaseIds } }, select: { id: true, ref: true, occupantName: true, unit: true, floorAreaSqm: true } });
    const activeLeases = await tx.lease.findMany({
      where: { companyId: ctx.companyId, assetId: position.period.assetId, status: "ACTIVE", startDate: { lte: position.period.endDate }, endDate: { gte: position.period.startDate } },
      select: { id: true, ref: true, occupantName: true, unit: true, floorAreaSqm: true }, orderBy: { ref: "asc" },
    });
    const userIds = new Set<string>();
    for (const e of position.period.expenses) { userIds.add(e.requestedById); if (e.decidedById) userIds.add(e.decidedById); }
    for (const a of position.period.assessments) for (const c of a.collections) userIds.add(c.recordedById);
    const users = await tx.user.findMany({ where: { id: { in: Array.from(userIds) } }, select: { id: true, name: true } });
    return {
      asset, ...position, leases: Object.fromEntries(leases.map((l) => [l.id, l])), activeLeases,
      names: Object.fromEntries(users.map((u) => [u.id, u.name])) as Record<string, string>,
    };
  });
}
