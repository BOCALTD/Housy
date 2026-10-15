// Pure rules for the rent ledger (master prompt Sections 12.2, 12.5 and 13.3).
// Kept free of database code so every rule can be tested exactly.

import { formatKobo } from "./money";

// ---------- Receipts and evidence ----------

/** Normalise a payment reference so "GTB Transfer 0001" and "gtb-transfer-0001" count as the same one. */
export function evidenceKey(evidence: string): string {
  return evidence.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export type ReceiptStatus = "RECORDED" | "RECONCILED" | "REVERSED";

export function receiptStatus(r: { reversed: boolean; reconciled: boolean }): ReceiptStatus {
  if (r.reversed) return "REVERSED";
  return r.reconciled ? "RECONCILED" : "RECORDED";
}

export function formatReceiptNo(year: number, sequence: number): string {
  return `RCT-${year}-${String(sequence).padStart(5, "0")}`;
}

// ---------- Allocating one payment across charges ----------

export type Allocatable = { id: string; dueDate: Date; outstandingKobo: bigint };
export type Allocation = { chargeId: string; amountKobo: bigint };

/**
 * Apply a payment to the oldest unpaid charges first. Later charges receive advance payments.
 * The split is exact: allocations always add up to the payment, and never exceed what is owed.
 */
export function allocatePayment(charges: Allocatable[], amountKobo: bigint): Allocation[] {
  if (amountKobo <= 0n) throw new Error("Payment must be more than zero");
  const open = charges
    .filter((c) => c.outstandingKobo > 0n)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (open.length === 0) throw new Error("Nothing is outstanding on this lease");
  const total = open.reduce((sum, c) => sum + c.outstandingKobo, 0n);
  if (amountKobo > total) {
    throw new Error(`Payment is more than the total outstanding on this lease (${formatKobo(total)})`);
  }
  const out: Allocation[] = [];
  let left = amountKobo;
  for (const c of open) {
    if (left === 0n) break;
    const take = left < c.outstandingKobo ? left : c.outstandingKobo;
    out.push({ chargeId: c.id, amountKobo: take });
    left -= take;
  }
  return out;
}

// ---------- Adjustments ----------

export const ADJUSTMENT_KINDS = ["LATE_FEE", "WAIVER", "CREDIT_NOTE", "CORRECTION"] as const;
export type AdjustmentKindName = (typeof ADJUSTMENT_KINDS)[number];

/**
 * The signed effect of an adjustment on the amount due. A late fee can only add. A waiver or credit
 * note can only reduce. A correction may go either way and must say which.
 */
export function signedAdjustment(kind: AdjustmentKindName, direction: "INCREASE" | "DECREASE" | undefined, amountKobo: bigint): bigint {
  if (amountKobo <= 0n) throw new Error("Enter an amount greater than zero");
  if (kind === "LATE_FEE") return amountKobo;
  if (kind === "WAIVER" || kind === "CREDIT_NOTE") return -amountKobo;
  if (direction === "INCREASE") return amountKobo;
  if (direction === "DECREASE") return -amountKobo;
  throw new Error("Say whether the correction increases or decreases the amount due");
}

/** An adjustment may never push what is owed below what has already been paid. */
export function checkAdjustmentFits(c: { amountKobo: bigint; adjustedKobo: bigint; paidKobo: bigint }, signedKobo: bigint): void {
  const next = c.amountKobo + c.adjustedKobo + signedKobo;
  if (next < c.paidKobo) {
    throw new Error("That reduction is more than the amount still unpaid on this charge. Reverse a receipt first if a payment was recorded in error.");
  }
}

// ---------- Deposits ----------

export type DepositKind = "RECEIVED" | "DEDUCTION" | "REFUND";

export function depositTotals(entries: { kind: DepositKind; amountKobo: bigint }[]) {
  let received = 0n, deducted = 0n, refunded = 0n;
  for (const e of entries) {
    if (e.kind === "RECEIVED") received += e.amountKobo;
    else if (e.kind === "DEDUCTION") deducted += e.amountKobo;
    else refunded += e.amountKobo;
  }
  return { received, deducted, refunded, balance: received - deducted - refunded };
}

/** Validate a new deposit entry against the agreed deposit, the running balance and the tenancy state. */
export function checkDepositEntry(opts: {
  kind: DepositKind;
  amountKobo: bigint;
  agreedKobo: bigint;
  totals: { received: bigint; balance: bigint };
  tenancyEnded: boolean;
}): void {
  const { kind, amountKobo, agreedKobo, totals, tenancyEnded } = opts;
  if (amountKobo <= 0n) throw new Error("Enter an amount greater than zero");
  if (kind === "RECEIVED") {
    if (agreedKobo <= 0n) throw new Error("No deposit was agreed for this lease");
    if (totals.received + amountKobo > agreedKobo) {
      throw new Error(`That would take the deposit received above the agreed ${formatKobo(agreedKobo)}`);
    }
    return;
  }
  if (!tenancyEnded) throw new Error("A deposit is settled once the tenancy has ended");
  if (amountKobo > totals.balance) {
    throw new Error(`That is more than the deposit still held (${formatKobo(totals.balance)})`);
  }
}

// ---------- Units ----------

/**
 * Two leases conflict if they could occupy the same space. A blank unit means the whole property,
 * which conflicts with every unit. Named units conflict only with the same name.
 */
export function unitsConflict(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  return x === "" || y === "" || x === y;
}

// ---------- Ageing ----------

export const AGEING_BUCKETS = ["1-30 days", "31-60 days", "61-90 days", "Over 90 days"] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

export function ageingBucket(daysOverdue: number): AgeingBucket {
  if (daysOverdue <= 30) return "1-30 days";
  if (daysOverdue <= 60) return "31-60 days";
  if (daysOverdue <= 90) return "61-90 days";
  return "Over 90 days";
}
