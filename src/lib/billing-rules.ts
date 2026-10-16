import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { addMonthsClamped, todayInLagos } from "./dates";

// Billing rules: pure, so they can be tested without a database or a payment provider.

export type Period = "NONE" | "MONTHLY" | "QUARTERLY" | "YEARLY";
export const PERIOD_MONTHS: Record<Period, number> = { NONE: 0, MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 };

/** How long one payment buys. Time already paid for is kept when the same plan is renewed; a different plan starts today. */
export function newPeriodEnd(o: { now: Date; currentEnd: Date | null; samePlan: boolean; months: number }): Date {
  const base = o.currentEnd && o.samePlan && o.currentEnd.getTime() > o.now.getTime() ? o.currentEnd : todayInLagos(o.now);
  // Periods end at the close of a day, like every other subscription period.
  return new Date(addMonthsClamped(base, o.months).getTime() + 864e5 - 1);
}

export const RENEWAL_NOTICE_DAYS = 7;
/** Whether it is time to ask for the next period's payment: shortly before the end, and for as long as the plan's grace period lasts. */
export function renewalDue(o: { periodEnd: Date; graceDays: number; now: Date; cancelled: boolean }): boolean {
  if (o.cancelled) return false;
  const t = o.now.getTime(), end = o.periodEnd.getTime();
  return t >= end - RENEWAL_NOTICE_DAYS * 864e5 && t <= end + o.graceDays * 864e5;
}

/** Which reminder stage a renewal invoice is at, so each stage is sent once: advance notice, the last day, overdue. */
export function reminderStage(periodEnd: Date, now: Date): "NOTICE" | "LAST_DAY" | "OVERDUE" {
  const left = periodEnd.getTime() - now.getTime();
  if (left < 0) return "OVERDUE";
  return left <= 864e5 ? "LAST_DAY" : "NOTICE";
}

export type Verdict = { ok: true } | { ok: false; reason: "AMOUNT" | "CURRENCY" | "INVOICE_CLOSED" };

/** Whether a provider's report of money received matches what was asked for. Anything else goes to a person, and nothing is applied. */
export function checkReceived(o: { expectedKobo: bigint; receivedKobo: bigint; currency: string; invoiceStatus: "OPEN" | "PAID" | "VOID" }): Verdict {
  if (o.currency.toUpperCase() !== "NGN") return { ok: false, reason: "CURRENCY" };
  if (o.receivedKobo !== o.expectedKobo) return { ok: false, reason: "AMOUNT" };
  if (o.invoiceStatus !== "OPEN") return { ok: false, reason: "INVOICE_CLOSED" };
  return { ok: true };
}

export const REVIEW_TEXT = {
  AMOUNT: "The amount received is not the amount asked for.",
  CURRENCY: "The payment was not in naira.",
  INVOICE_CLOSED: "The invoice was already paid or cancelled when this payment arrived.",
} as const;

/** The most that can still be given back on a payment. */
export const refundable = (p: { receivedKobo: bigint | null; amountKobo: bigint; refundedKobo: bigint }) => (p.receivedKobo ?? p.amountKobo) - p.refundedKobo;

export function randomRef(prefix: string, rnd: () => number = Math.random): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += A[Math.floor(rnd() * A.length)];
  return `${prefix}-${s}`;
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Constant-time comparison of two hex strings. */
export function sameHex(a: string, b: string): boolean {
  const x = Buffer.from(a.toLowerCase()), y = Buffer.from(b.toLowerCase());
  return x.length === y.length && timingSafeEqual(x, y);
}
export const hmacSha512 = (secret: string, body: string) => createHmac("sha512", secret).update(body).digest("hex");
