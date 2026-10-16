import { z } from "zod";
import { withTenant, type Tx } from "../db";
import { logActivity } from "../audit";
import { parseNairaToKobo } from "../money";
import { parseDateOnly, todayInLagos } from "../dates";
import { applyPayment, generateRentSchedule, outstandingOf } from "../rent";
import { allocatePayment, evidenceKey, formatReceiptNo, unitsConflict, type Allocation } from "../ledger-rules";
import { lockKey } from "../locks";
import { nextNumber } from "../numbering";
import { assertCan, type Ctx } from "./context";

export const FREQUENCIES = ["MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY", "CUSTOM"] as const;
export const PAYMENT_METHODS = ["Bank transfer", "Cash", "Cheque", "POS", "Online payment", "Other"] as const;

/** A whole number from a form field. Blank means "not given". */
function optionalWhole(label: string, min: number, max: number) {
  return z.string().trim().optional().transform((v, ctx): number | null => {
    if (v === undefined || v === "") return null;
    if (!/^\d+$/.test(v)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be a whole number` });
      return z.NEVER;
    }
    const n = Number(v);
    if (n < min || n > max) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be between ${min} and ${max}` });
      return z.NEVER;
    }
    return n;
  });
}

export const leaseSchema = z.object({
  occupantName: z.string().trim().min(2, "Enter the tenant or occupying organization").max(200),
  occupantContact: z.string().trim().max(200).default(""),
  unit: z.string().trim().max(60).default(""),
  startDate: z.string().transform((v) => parseDateOnly(v)),
  endDate: z.string().transform((v) => parseDateOnly(v)),
  rent: z.string().transform((v) => parseNairaToKobo(v)),
  frequency: z.enum(FREQUENCIES),
  intervalMonths: optionalWhole("The payment interval", 1, 120),
  floorAreaSqm: optionalWhole("The floor area", 1, 10_000_000),
  deposit: z.string().optional().transform((v) => (v ? parseNairaToKobo(v) : 0n)),
  graceDays: optionalWhole("Grace days", 0, 90),
  noticeDays: optionalWhole("The notice period", 0, 365),
  permittedUse: z.string().trim().max(300).default(""),
  otherTerms: z.string().trim().max(3000).default(""),
});

export type LeaseData = z.output<typeof leaseSchema>;

/** Create a lease and its full rent schedule in one transaction (master prompt Section 12.2). */
export async function createLease(ctx: Ctx, assetId: string, input: z.input<typeof leaseSchema>) {
  assertCan(ctx, "lease.manage");
  const data = leaseSchema.parse(input);
  return withTenant(ctx.companyId, ctx.userId, (tx) => insertLease(tx, ctx, assetId, data, null));
}

/** Shared by lease creation and approved renewals. The caller has checked permission. */
export async function insertLease(tx: Tx, ctx: Ctx, assetId: string, data: LeaseData, renewedFromId: string | null) {
  const intervalMonths = data.frequency === "CUSTOM" ? data.intervalMonths : null;
  const schedule = generateRentSchedule({
    startDate: data.startDate, endDate: data.endDate, frequency: data.frequency, rentKobo: data.rent, intervalMonths,
  });
  {
    const asset = await tx.asset.findFirst({ where: { id: assetId, companyId: ctx.companyId } });
    if (!asset) throw new Error("Asset not found");
    // Two leases may share a property only if they are for different units.
    const active = await tx.lease.findMany({
      where: { companyId: ctx.companyId, assetId, status: "ACTIVE", startDate: { lt: data.endDate }, endDate: { gt: data.startDate } },
      select: { ref: true, unit: true },
    });
    const clash = active.find((l) => unitsConflict(l.unit, data.unit));
    if (clash) throw new Error(`This asset already has an active lease (${clash.ref}) for those dates${data.unit ? " and unit" : ""}.`);
    // Serialise reference allocation so two leases created at once never share a number.
    await lockKey(tx, `lease-ref:${ctx.companyId}`);
    const count = await tx.lease.count({ where: { companyId: ctx.companyId } });
    const ref = `LSE-${String(count + 1).padStart(5, "0")}`;
    const lease = await tx.lease.create({
      data: {
        companyId: ctx.companyId, assetId, ref, occupantName: data.occupantName,
        occupantContact: data.occupantContact, unit: data.unit, startDate: data.startDate, endDate: data.endDate,
        rentKobo: data.rent, frequency: data.frequency, intervalMonths, depositKobo: data.deposit,
        graceDays: data.graceDays ?? 0, noticeDays: data.noticeDays ?? 0, floorAreaSqm: data.floorAreaSqm ?? null,
        permittedUse: data.permittedUse, otherTerms: data.otherTerms, renewedFromId, createdById: ctx.userId,
      },
    });
    await tx.rentCharge.createMany({
      data: schedule.map((c) => ({ companyId: ctx.companyId, leaseId: lease.id, dueDate: c.dueDate, amountKobo: c.amountKobo })),
    });
    const today = todayInLagos();
    if (data.startDate <= today && data.endDate > today && asset.status !== "OCCUPIED") {
      await tx.asset.update({ where: { id: asset.id }, data: { status: "OCCUPIED" } });
      await logActivity(tx, {
        companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: asset.id,
        action: "asset.status_changed", detail: { from: asset.status, to: "OCCUPIED", reason: `Lease ${ref} started` },
      });
    }
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "lease", entityId: lease.id,
      action: "lease.created",
      detail: { ref, occupant: data.occupantName, unit: data.unit, charges: schedule.length, frequency: data.frequency,
                rentKobo: data.rent.toString(), ...(renewedFromId ? { renewedFrom: renewedFromId } : {}) },
    });
    return lease;
  }
}

const paymentSchema = z.object({
  amount: z.string().transform((v) => parseNairaToKobo(v)),
  paidOn: z.string().transform((v) => parseDateOnly(v)),
  evidence: z.string().trim().min(3, "Record the payment evidence, for example a bank transfer reference").max(500),
  method: z.string().trim().max(40).default(""),
  payerName: z.string().trim().max(200).default(""),
});

type PaymentData = z.output<typeof paymentSchema>;

/**
 * Issue a receipt for money received on a lease and apply it to charges. Callers hold row locks on
 * the charges involved. A payment needs evidence, the same evidence cannot be recorded twice, and a
 * reminder or status change is never treated as proof of payment (master prompt Section 12.2).
 */
async function postReceipt(tx: Tx, ctx: Ctx, leaseId: string, data: PaymentData, onlyChargeId: string | null) {
  const today = todayInLagos();
  if (data.paidOn > today) throw new Error("The payment date cannot be in the future");
  const key = evidenceKey(data.evidence);
  if (key.length < 3) throw new Error("Record the payment evidence: a reference with at least 3 letters or digits");
  // The same reference can be recorded only once, unless the earlier receipt was reversed.
  await lockKey(tx, `receipt-evidence:${ctx.companyId}:${key}`);
  const duplicate = await tx.receipt.findFirst({
    where: { companyId: ctx.companyId, evidenceKey: key, reversal: { is: null } },
    select: { no: true },
  });
  if (duplicate) {
    throw new Error(`That evidence reference is already recorded on receipt ${duplicate.no}. Use this payment's own reference, or reverse the earlier receipt first.`);
  }

  const charges = await tx.rentCharge.findMany({
    where: { leaseId, companyId: ctx.companyId, ...(onlyChargeId ? { id: onlyChargeId } : {}) },
    orderBy: { dueDate: "asc" },
  });
  let allocations: Allocation[];
  if (onlyChargeId) {
    const charge = charges[0];
    if (!charge) throw new Error("Rent charge not found");
    applyPayment(charge, data.amount);
    allocations = [{ chargeId: charge.id, amountKobo: data.amount }];
  } else {
    allocations = allocatePayment(
      charges.map((c) => ({ id: c.id, dueDate: c.dueDate, outstandingKobo: outstandingOf(c) })),
      data.amount,
    );
  }

  const year = today.getUTCFullYear();
  const no = formatReceiptNo(year, await nextNumber(tx, ctx.companyId, "RECEIPT", year));
  const receipt = await tx.receipt.create({
    data: {
      companyId: ctx.companyId, leaseId, no, amountKobo: data.amount, paidOn: data.paidOn, method: data.method,
      payerName: data.payerName, evidence: data.evidence, evidenceKey: key, recordedById: ctx.userId,
    },
  });
  for (const a of allocations) {
    await tx.rentPayment.create({
      data: {
        companyId: ctx.companyId, chargeId: a.chargeId, receiptId: receipt.id, amountKobo: a.amountKobo,
        paidOn: data.paidOn, evidence: data.evidence, recordedById: ctx.userId,
      },
      select: { id: true },
    });
    await tx.rentCharge.update({ where: { id: a.chargeId }, data: { paidKobo: { increment: a.amountKobo } } });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "rent_charge", entityId: a.chargeId,
      action: "payment.recorded",
      detail: { receiptNo: no, amountKobo: a.amountKobo.toString(), paidOn: data.paidOn.toISOString().slice(0, 10), evidence: data.evidence },
    });
  }
  return receipt;
}

/**
 * Opening balance for a lease brought in from old records: the total already paid, cleared against the oldest rent first,
 * on one receipt whose evidence names the import. The caller has checked permission and holds the transaction.
 */
export async function postOpeningReceipt(tx: Tx, ctx: Ctx, leaseId: string, amountKobo: bigint, evidence: string) {
  const data = paymentSchema.parse({ amount: (amountKobo / 100n).toString() + "." + String(amountKobo % 100n).padStart(2, "0"), paidOn: todayInLagos().toISOString().slice(0, 10), evidence, method: "Opening balance", payerName: "" });
  return postReceipt(tx, ctx, leaseId, data, null);
}

/** Record a payment against one specific charge. */
export async function recordPayment(ctx: Ctx, chargeId: string, input: z.input<typeof paymentSchema>) {
  assertCan(ctx, "payment.record");
  const data = paymentSchema.parse(input);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    // Lock the charge row so two concurrent payments cannot both pass the overpayment check.
    const rows = await tx.$queryRaw<{ id: string; lease_id: string }[]>`
      SELECT id, lease_id FROM rent_charges WHERE id = ${chargeId} AND company_id = ${ctx.companyId} FOR UPDATE`;
    if (rows.length === 0) throw new Error("Rent charge not found");
    return postReceipt(tx, ctx, rows[0].lease_id, data, chargeId);
  });
}

/** Record one payment for a lease and apply it to the oldest unpaid charges first. */
export async function recordLeasePayment(ctx: Ctx, leaseId: string, input: z.input<typeof paymentSchema>) {
  assertCan(ctx, "payment.record");
  const data = paymentSchema.parse(input);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const lease = await tx.lease.findFirst({ where: { id: leaseId, companyId: ctx.companyId }, select: { id: true } });
    if (!lease) throw new Error("Lease not found");
    // Lock every charge on the lease, in a fixed order, so concurrent payments cannot overpay.
    await tx.$queryRaw`SELECT id FROM rent_charges WHERE lease_id = ${leaseId} AND company_id = ${ctx.companyId} ORDER BY id FOR UPDATE`;
    return postReceipt(tx, ctx, leaseId, data, null);
  });
}

/** One lease with its charges, receipts, adjustments, deposit ledger and history. Null if not in this company. */
export async function getLease(ctx: Ctx, leaseId: string) {
  assertCan(ctx, "finance.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const lease = await tx.lease.findFirst({
      where: { id: leaseId, companyId: ctx.companyId },
      include: {
        asset: { select: { id: true, ref: true, name: true } },
        charges: { orderBy: { dueDate: "asc" }, include: { adjustments: { orderBy: { createdAt: "desc" } } } },
        receipts: { orderBy: { createdAt: "desc" }, include: { allocations: true, reconciliation: true, reversal: true } },
        depositEntries: { orderBy: { createdAt: "asc" } },
        renewals: { orderBy: { createdAt: "desc" } },
        notices: { orderBy: { createdAt: "desc" } },
        handovers: { orderBy: { createdAt: "asc" } },
        renewedFrom: { select: { id: true, ref: true } },
        renewedTo: { select: { id: true, ref: true } },
      },
    });
    if (!lease) return null;
    const history = await tx.activityLog.findMany({
      where: { companyId: ctx.companyId, entityId: { in: [lease.id, ...lease.charges.map((c) => c.id)] } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const userIds = new Set<string>();
    for (const r of lease.receipts) {
      userIds.add(r.recordedById);
      if (r.reconciliation) userIds.add(r.reconciliation.reconciledById);
      if (r.reversal) userIds.add(r.reversal.reversedById);
    }
    for (const c of lease.charges) {
      for (const a of c.adjustments) {
        userIds.add(a.requestedById);
        if (a.decidedById) userIds.add(a.decidedById);
      }
    }
    for (const e of lease.depositEntries) userIds.add(e.recordedById);
    for (const r of lease.renewals) { userIds.add(r.requestedById); if (r.decidedById) userIds.add(r.decidedById); }
    for (const n of lease.notices) userIds.add(n.recordedById);
    for (const h of lease.handovers) userIds.add(h.recordedById);
    for (const h of history) if (h.actorId) userIds.add(h.actorId);
    const users = await tx.user.findMany({ where: { id: { in: Array.from(userIds) } }, select: { id: true, name: true } });
    return { lease, history, names: Object.fromEntries(users.map((u) => [u.id, u.name])) as Record<string, string> };
  });
}

/** A single receipt for printing. Null if not in this company. */
export async function getReceipt(ctx: Ctx, receiptId: string) {
  assertCan(ctx, "finance.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const receipt = await tx.receipt.findFirst({
      where: { id: receiptId, companyId: ctx.companyId },
      include: {
        allocations: { include: { charge: { select: { dueDate: true } } }, orderBy: { createdAt: "asc" } },
        reconciliation: true,
        reversal: true,
        lease: { include: { asset: { select: { id: true, ref: true, name: true } } } },
      },
    });
    if (!receipt) return null;
    const company = await tx.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { name: true } });
    const recorder = await tx.user.findUnique({ where: { id: receipt.recordedById }, select: { name: true } });
    return { receipt, companyName: company.name, recordedBy: recorder?.name ?? "Unknown user" };
  });
}
