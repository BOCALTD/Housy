/**
 * The accounting export: a period's rent, deposit and service charge records from the company's own ledgers, as balanced
 * journals (accounting-rules.ts). Read-only; nothing in the platform's records changes.
 */
import { withTenant } from "../db";
import { logActivity } from "../audit";
import { parseDateOnly, toDateOnlyString } from "../dates";
import { ACCOUNTS, buildJournal, cleanCodes, type AccountCodes, type AccountingEvent } from "../accounting-rules";
import { assertCan, type Ctx } from "./context";

const MAX_DAYS = 400;
const lagosDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(d);

export function exportPeriod(fromRaw: string, toRaw: string) {
  const from = parseDateOnly(fromRaw), to = parseDateOnly(toRaw);
  if (to < from) throw new Error("The end of the period is before its start");
  if ((to.getTime() - from.getTime()) / 864e5 > MAX_DAYS) throw new Error("Export at most 400 days at a time");
  return { from, to, toEnd: new Date(to.getTime() + 864e5) };
}

export async function accountingCodes(ctx: Ctx): Promise<AccountCodes> {
  const row = await withTenant(ctx.companyId, ctx.userId, (tx) => tx.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { accountingCodes: true } }));
  return cleanCodes((row.accountingCodes ?? {}) as Record<string, unknown>).codes;
}

export async function saveAccountingCodes(ctx: Ctx, raw: Record<string, unknown>) {
  assertCan(ctx, "settings.manage");
  const { codes, problems } = cleanCodes(raw);
  if (problems.length) throw new Error(problems.join(". "));
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await tx.company.update({ where: { id: ctx.companyId }, data: { accountingCodes: codes } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "company", entityId: ctx.companyId, action: "settings.accounting_codes", detail: codes });
  });
  return codes;
}

type AssetBit = { ref: string; name: string; companyRelationship: string };
const prop = (a: AssetBit) => `${a.ref} ${a.name}`;

/** Every record in the period that moves money or what is owed, as accounting events. */
export async function accountingEvents(ctx: Ctx, fromRaw: string, toRaw: string): Promise<AccountingEvent[]> {
  assertCan(ctx, "finance.view");
  const { from, to, toEnd } = exportPeriod(fromRaw, toRaw);
  const asset = { select: { ref: true, name: true, companyRelationship: true } } as const;
  const lease = { select: { ref: true, occupantName: true, asset } } as const;
  const c = ctx.companyId;
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const [charges, adjustments, receipts, reversals, deposits, assessments, collections, colReversals, expenses] = await Promise.all([
      tx.rentCharge.findMany({ where: { companyId: c, dueDate: { gte: from, lte: to } }, select: { id: true, dueDate: true, amountKobo: true, lease }, take: 50_000 }),
      tx.rentAdjustment.findMany({ where: { companyId: c, status: "APPROVED", decidedAt: { gte: from, lt: toEnd } }, select: { kind: true, amountKobo: true, reason: true, decidedAt: true, charge: { select: { dueDate: true, lease } } }, take: 50_000 }),
      tx.receipt.findMany({ where: { companyId: c, paidOn: { gte: from, lte: to } }, select: { no: true, amountKobo: true, paidOn: true, method: true, payerName: true, allocations: { select: { amountKobo: true } }, lease }, take: 50_000 }),
      tx.receiptReversal.findMany({ where: { companyId: c, createdAt: { gte: from, lt: toEnd } }, select: { createdAt: true, reason: true, receipt: { select: { no: true, amountKobo: true, allocations: { select: { amountKobo: true } }, lease } } }, take: 50_000 }),
      tx.depositEntry.findMany({ where: { companyId: c, entryDate: { gte: from, lte: to } }, select: { kind: true, amountKobo: true, entryDate: true, reason: true, lease }, take: 50_000 }),
      tx.serviceAssessment.findMany({ where: { companyId: c, dueDate: { gte: from, lte: to } }, select: { amountKobo: true, dueDate: true, lease: { select: { ref: true, occupantName: true } }, period: { select: { name: true, asset } } }, take: 50_000 }),
      tx.serviceCollection.findMany({ where: { companyId: c, paidOn: { gte: from, lte: to } }, select: { amountKobo: true, paidOn: true, method: true, assessment: { select: { lease: { select: { ref: true, occupantName: true } }, period: { select: { name: true, asset } } } } }, take: 50_000 }),
      tx.serviceCollectionReversal.findMany({ where: { companyId: c, createdAt: { gte: from, lt: toEnd } }, select: { createdAt: true, reason: true, collection: { select: { amountKobo: true, assessment: { select: { lease: { select: { ref: true, occupantName: true } }, period: { select: { name: true, asset } } } } } } }, take: 50_000 }),
      tx.serviceExpense.findMany({ where: { companyId: c, status: "APPROVED", incurredOn: { gte: from, lte: to } }, select: { description: true, supplier: true, amountKobo: true, incurredOn: true, period: { select: { name: true, asset } } }, take: 50_000 }),
    ]);
    const owned = (a: AssetBit) => a.companyRelationship === "OWNER";
    const sum = (xs: { amountKobo: bigint }[]) => xs.reduce((s, x) => s + x.amountKobo, 0n);
    const ev: AccountingEvent[] = [
      ...charges.map((x) => ({ kind: "CHARGE" as const, date: toDateOnlyString(x.dueDate), ref: x.lease.ref, property: prop(x.lease.asset), owned: owned(x.lease.asset), amount: x.amountKobo, memo: `${x.lease.occupantName}, due ${toDateOnlyString(x.dueDate)}` })),
      ...adjustments.map((x) => ({ kind: "ADJUSTMENT" as const, date: lagosDay(x.decidedAt!), ref: x.charge.lease.ref, property: prop(x.charge.lease.asset), owned: owned(x.charge.lease.asset), amount: x.amountKobo, adjustment: x.kind, memo: `${x.charge.lease.occupantName}: ${x.reason}`.slice(0, 200) })),
      ...receipts.map((x) => ({ kind: "RECEIPT" as const, date: toDateOnlyString(x.paidOn), ref: x.no, property: prop(x.lease.asset), amount: x.amountKobo, allocated: sum(x.allocations), memo: `${x.payerName || x.lease.occupantName}${x.method ? `, ${x.method}` : ""} (${x.lease.ref})` })),
      ...reversals.map((x) => ({ kind: "RECEIPT" as const, reversed: true, date: lagosDay(x.createdAt), ref: x.receipt.no, property: prop(x.receipt.lease.asset), amount: x.receipt.amountKobo, allocated: sum(x.receipt.allocations), memo: x.reason.slice(0, 200) })),
      ...deposits.map((x) => ({ kind: "DEPOSIT" as const, entry: x.kind, date: toDateOnlyString(x.entryDate), ref: x.lease.ref, property: prop(x.lease.asset), owned: owned(x.lease.asset), amount: x.amountKobo, memo: `${x.lease.occupantName}${x.reason ? `: ${x.reason}` : ""}`.slice(0, 200) })),
      ...assessments.map((x) => ({ kind: "SERVICE_ASSESSMENT" as const, date: toDateOnlyString(x.dueDate), ref: x.lease.ref, property: prop(x.period.asset), amount: x.amountKobo, memo: `${x.lease.occupantName}, ${x.period.name}` })),
      ...collections.map((x) => ({ kind: "SERVICE_COLLECTION" as const, date: toDateOnlyString(x.paidOn), ref: x.assessment.lease.ref, property: prop(x.assessment.period.asset), amount: x.amountKobo, memo: `${x.assessment.lease.occupantName}, ${x.assessment.period.name}${x.method ? `, ${x.method}` : ""}` })),
      ...colReversals.map((x) => ({ kind: "SERVICE_COLLECTION" as const, reversed: true, date: lagosDay(x.createdAt), ref: x.collection.assessment.lease.ref, property: prop(x.collection.assessment.period.asset), amount: x.collection.amountKobo, memo: x.reason.slice(0, 200) })),
      ...expenses.map((x) => ({ kind: "SERVICE_EXPENSE" as const, date: toDateOnlyString(x.incurredOn), ref: x.period.name, property: prop(x.period.asset), amount: x.amountKobo, memo: `${x.description}${x.supplier ? ` (${x.supplier})` : ""}`.slice(0, 200) })),
    ];
    return ev;
  });
}

/** The journal and account totals for a period, with the company's codes. */
export async function accountingJournal(ctx: Ctx, from: string, to: string) {
  const [events, codes] = await Promise.all([accountingEvents(ctx, from, to), accountingCodes(ctx)]);
  const j = buildJournal(events);
  return { ...j, codes, accounts: ACCOUNTS };
}

export async function logAccountingExport(ctx: Ctx, from: string, to: string, entries: number) {
  await withTenant(ctx.companyId, ctx.userId, (tx) => logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "company", entityId: ctx.companyId, action: "report.accounting_export", detail: { from, to, entries } }));
}
