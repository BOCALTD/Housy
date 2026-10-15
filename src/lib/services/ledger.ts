import { z } from "zod";
import { withTenant, type Tx } from "../db";
import { logActivity } from "../audit";
import { parseNairaToKobo } from "../money";
import { parseDateOnly, todayInLagos } from "../dates";
import {
  ADJUSTMENT_KINDS, checkAdjustmentFits, checkDepositEntry, depositTotals, signedAdjustment, type DepositKind,
} from "../ledger-rules";
import { assertCan, type Ctx } from "./context";

// Reversals, reconciliation, adjustments, deposits and the ledger check
// (master prompt Sections 12.2, 12.5 and 13.3).

async function lockRow(tx: Tx, table: "receipts" | "rent_adjustments" | "rent_charges" | "leases", id: string, companyId: string) {
  // Table names come from the fixed list above, never from input.
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM ${table} WHERE id = $1 AND company_id = $2 FOR UPDATE`, id, companyId);
  return rows.length > 0;
}

// ---------- Receipts: reverse and reconcile ----------

/**
 * Reverse a receipt that was recorded in error. The receipt stays on file, marked reversed, and the
 * charges it paid go back to unpaid. A receipt reconciled to a bank statement cannot be reversed.
 */
export async function reverseReceipt(ctx: Ctx, receiptId: string, reasonInput: string) {
  assertCan(ctx, "payment.reverse");
  const reason = z.string().trim().min(5, "Give the reason for reversing this receipt").max(500).parse(reasonInput);
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    if (!(await lockRow(tx, "receipts", receiptId, ctx.companyId))) throw new Error("Receipt not found");
    const receipt = await tx.receipt.findUniqueOrThrow({
      where: { id: receiptId }, include: { allocations: true, reversal: true, reconciliation: true },
    });
    if (receipt.reversal) throw new Error("This receipt has already been reversed");
    if (receipt.reconciliation) {
      throw new Error("This receipt has been reconciled to a bank statement and cannot be reversed here.");
    }
    const allocations = [...receipt.allocations].sort((a, b) => (a.chargeId < b.chargeId ? -1 : a.chargeId > b.chargeId ? 1 : 0));
    for (const a of allocations) {
      await lockRow(tx, "rent_charges", a.chargeId, ctx.companyId);
      await tx.rentCharge.update({ where: { id: a.chargeId }, data: { paidKobo: { decrement: a.amountKobo } } });
    }
    await tx.receiptReversal.create({
      data: { companyId: ctx.companyId, receiptId, reason, reversedById: ctx.userId },
      select: { id: true },
    });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "lease", entityId: receipt.leaseId,
      action: "receipt.reversed", detail: { receiptNo: receipt.no, amountKobo: receipt.amountKobo.toString(), reason },
    });
  });
}

const reconcileSchema = z.object({
  statementRef: z.string().trim().min(3, "Enter the bank statement date and line, or the transaction reference").max(200),
  note: z.string().trim().max(500).default(""),
});

/**
 * Confirm a receipt against a bank statement line. The person who recorded the receipt cannot also
 * reconcile it, so one person can never both claim and confirm a payment.
 */
export async function reconcileReceipt(ctx: Ctx, receiptId: string, input: z.input<typeof reconcileSchema>) {
  assertCan(ctx, "payment.reconcile");
  const data = reconcileSchema.parse(input);
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    if (!(await lockRow(tx, "receipts", receiptId, ctx.companyId))) throw new Error("Receipt not found");
    const receipt = await tx.receipt.findUniqueOrThrow({ where: { id: receiptId }, include: { reversal: true, reconciliation: true } });
    if (receipt.reversal) throw new Error("This receipt was reversed and cannot be reconciled");
    if (receipt.reconciliation) throw new Error("This receipt is already reconciled");
    if (receipt.recordedById === ctx.userId) {
      throw new Error("A receipt must be reconciled by someone other than the person who recorded it");
    }
    await tx.receiptReconciliation.create({
      data: { companyId: ctx.companyId, receiptId, statementRef: data.statementRef, note: data.note, reconciledById: ctx.userId },
      select: { id: true },
    });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "lease", entityId: receipt.leaseId,
      action: "receipt.reconciled", detail: { receiptNo: receipt.no, statementRef: data.statementRef },
    });
  });
}

// ---------- Adjustments ----------

const adjustmentSchema = z.object({
  kind: z.enum(ADJUSTMENT_KINDS),
  direction: z.enum(["INCREASE", "DECREASE"]).optional(),
  amount: z.string().transform((v) => parseNairaToKobo(v)),
  reason: z.string().trim().min(5, "Give the reason, and the lease clause if a late fee").max(500),
});

/** Ask for a late fee, waiver, credit note or correction on one charge. Nothing changes until it is approved. */
export async function requestAdjustment(ctx: Ctx, chargeId: string, input: z.input<typeof adjustmentSchema>) {
  assertCan(ctx, "adjustment.request");
  const data = adjustmentSchema.parse(input);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    if (!(await lockRow(tx, "rent_charges", chargeId, ctx.companyId))) throw new Error("Rent charge not found");
    const charge = await tx.rentCharge.findUniqueOrThrow({ where: { id: chargeId } });
    const signed = signedAdjustment(data.kind, data.direction, data.amount);
    checkAdjustmentFits(charge, signed);
    const adjustment = await tx.rentAdjustment.create({
      data: { companyId: ctx.companyId, chargeId, kind: data.kind, amountKobo: signed, reason: data.reason, requestedById: ctx.userId },
    });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "rent_charge", entityId: chargeId,
      action: "adjustment.requested", detail: { kind: data.kind, amountKobo: signed.toString(), reason: data.reason },
    });
    return adjustment;
  });
}

/** Approve or reject an adjustment. The person who asked for it cannot approve it. */
export async function decideAdjustment(ctx: Ctx, adjustmentId: string, decision: "approve" | "reject", noteInput = "") {
  assertCan(ctx, "adjustment.approve");
  const note = z.string().trim().max(500).parse(noteInput);
  if (decision === "reject" && note.length < 3) throw new Error("Give a reason for rejecting this request");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    if (!(await lockRow(tx, "rent_adjustments", adjustmentId, ctx.companyId))) throw new Error("Adjustment not found");
    const adjustment = await tx.rentAdjustment.findUniqueOrThrow({ where: { id: adjustmentId } });
    if (adjustment.status !== "PENDING") throw new Error("This request has already been decided");
    if (decision === "approve") {
      if (adjustment.requestedById === ctx.userId) {
        throw new Error("An adjustment must be approved by someone other than the person who requested it");
      }
      await lockRow(tx, "rent_charges", adjustment.chargeId, ctx.companyId);
      const charge = await tx.rentCharge.findUniqueOrThrow({ where: { id: adjustment.chargeId } });
      // Payments may have been recorded since the request was made, so check again.
      checkAdjustmentFits(charge, adjustment.amountKobo);
      await tx.rentCharge.update({ where: { id: charge.id }, data: { adjustedKobo: { increment: adjustment.amountKobo } } });
    }
    await tx.rentAdjustment.update({
      where: { id: adjustmentId },
      data: { status: decision === "approve" ? "APPROVED" : "REJECTED", decidedById: ctx.userId, decidedAt: new Date(), decisionNote: note },
    });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "rent_charge", entityId: adjustment.chargeId,
      action: decision === "approve" ? "adjustment.approved" : "adjustment.rejected",
      detail: { kind: adjustment.kind, amountKobo: adjustment.amountKobo.toString(), note },
    });
  });
}

// ---------- Deposits ----------

const depositReceivedSchema = z.object({
  amount: z.string().transform((v) => parseNairaToKobo(v)),
  receivedOn: z.string().transform((v) => parseDateOnly(v)),
  evidence: z.string().trim().min(3, "Record the evidence, for example a bank transfer reference").max(500),
});

async function depositState(tx: Tx, ctx: Ctx, leaseId: string) {
  if (!(await lockRow(tx, "leases", leaseId, ctx.companyId))) throw new Error("Lease not found");
  const lease = await tx.lease.findUniqueOrThrow({ where: { id: leaseId } });
  const entries = await tx.depositEntry.findMany({ where: { leaseId, companyId: ctx.companyId } });
  return { lease, totals: depositTotals(entries.map((e) => ({ kind: e.kind as DepositKind, amountKobo: e.amountKobo }))) };
}

/** Record deposit money received from the tenant, up to the amount agreed in the lease. */
export async function recordDepositReceived(ctx: Ctx, leaseId: string, input: z.input<typeof depositReceivedSchema>) {
  assertCan(ctx, "deposit.manage");
  const data = depositReceivedSchema.parse(input);
  if (data.receivedOn > todayInLagos()) throw new Error("The date received cannot be in the future");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const { lease, totals } = await depositState(tx, ctx, leaseId);
    checkDepositEntry({ kind: "RECEIVED", amountKobo: data.amount, agreedKobo: lease.depositKobo, totals, tenancyEnded: false });
    await tx.depositEntry.create({
      data: {
        companyId: ctx.companyId, leaseId, kind: "RECEIVED", amountKobo: data.amount, evidence: data.evidence,
        entryDate: data.receivedOn, recordedById: ctx.userId,
      },
      select: { id: true },
    });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "lease", entityId: leaseId,
      action: "deposit.received", detail: { amountKobo: data.amount.toString(), evidence: data.evidence },
    });
  });
}

const settleSchema = z.object({
  kind: z.enum(["DEDUCTION", "REFUND"]),
  amount: z.string().transform((v) => parseNairaToKobo(v)),
  reason: z.string().trim().min(5, "Give the reason, for example the repair or the final inspection").max(500),
  evidence: z.string().trim().max(500).default(""),
});

/** Deduct from or refund the deposit after the tenancy has ended. Only managers can settle a deposit. */
export async function settleDeposit(ctx: Ctx, leaseId: string, input: z.input<typeof settleSchema>) {
  assertCan(ctx, "deposit.settle");
  const data = settleSchema.parse(input);
  if (data.kind === "REFUND" && data.evidence.length < 3) throw new Error("Record the refund's payment reference");
  const today = todayInLagos();
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const { lease, totals } = await depositState(tx, ctx, leaseId);
    const tenancyEnded = lease.status !== "ACTIVE" || lease.endDate <= today;
    checkDepositEntry({ kind: data.kind, amountKobo: data.amount, agreedKobo: lease.depositKobo, totals, tenancyEnded });
    await tx.depositEntry.create({
      data: {
        companyId: ctx.companyId, leaseId, kind: data.kind, amountKobo: data.amount, reason: data.reason,
        evidence: data.evidence, entryDate: today, recordedById: ctx.userId,
      },
      select: { id: true },
    });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "lease", entityId: leaseId,
      action: data.kind === "REFUND" ? "deposit.refunded" : "deposit.deducted",
      detail: { amountKobo: data.amount.toString(), reason: data.reason },
    });
  });
}

// ---------- Consistency check ----------

export type LedgerProblem = { entity: string; id: string; message: string };

/**
 * Recompute every balance from the underlying records and report any that disagree. A healthy ledger
 * returns an empty list. This is what keeps "financial statuses consistent with verified records" true.
 */
export async function verifyLedger(ctx: Ctx): Promise<LedgerProblem[]> {
  assertCan(ctx, "finance.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const problems: LedgerProblem[] = [];
    const paid = await tx.$queryRaw<{ id: string; recorded: string; expected: string }[]>`
      SELECT c.id, c.paid_kobo::text AS recorded, coalesce(s.total, 0)::text AS expected
      FROM rent_charges c
      LEFT JOIN (
        SELECT p.charge_id, sum(p.amount_kobo) AS total
        FROM rent_payments p JOIN receipts r ON r.id = p.receipt_id
        WHERE r.company_id = ${ctx.companyId}
          AND NOT EXISTS (SELECT 1 FROM receipt_reversals v WHERE v.receipt_id = r.id)
        GROUP BY p.charge_id
      ) s ON s.charge_id = c.id
      WHERE c.company_id = ${ctx.companyId} AND c.paid_kobo <> coalesce(s.total, 0)`;
    for (const r of paid) {
      problems.push({ entity: "rent_charge", id: r.id, message: `Paid amount is ${r.recorded} kobo but unreversed receipts add up to ${r.expected} kobo` });
    }
    const adjusted = await tx.$queryRaw<{ id: string; recorded: string; expected: string }[]>`
      SELECT c.id, c.adjusted_kobo::text AS recorded, coalesce(s.total, 0)::text AS expected
      FROM rent_charges c
      LEFT JOIN (
        SELECT charge_id, sum(amount_kobo) AS total FROM rent_adjustments
        WHERE company_id = ${ctx.companyId} AND status = 'APPROVED' GROUP BY charge_id
      ) s ON s.charge_id = c.id
      WHERE c.company_id = ${ctx.companyId} AND c.adjusted_kobo <> coalesce(s.total, 0)`;
    for (const r of adjusted) {
      problems.push({ entity: "rent_charge", id: r.id, message: `Adjusted amount is ${r.recorded} kobo but approved adjustments add up to ${r.expected} kobo` });
    }
    const receipts = await tx.$queryRaw<{ id: string; recorded: string; expected: string }[]>`
      SELECT r.id, r.amount_kobo::text AS recorded, coalesce(s.total, 0)::text AS expected
      FROM receipts r
      LEFT JOIN (
        SELECT receipt_id, sum(amount_kobo) AS total FROM rent_payments WHERE company_id = ${ctx.companyId} GROUP BY receipt_id
      ) s ON s.receipt_id = r.id
      WHERE r.company_id = ${ctx.companyId} AND r.amount_kobo <> coalesce(s.total, 0)`;
    for (const r of receipts) {
      problems.push({ entity: "receipt", id: r.id, message: `Receipt is for ${r.recorded} kobo but is applied to ${r.expected} kobo` });
    }
    return problems;
  });
}
