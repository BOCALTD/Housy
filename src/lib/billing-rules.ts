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
/** A free trial is reminded 3 days before it ends, so a short trial is not asked to pay the moment it starts. */
export const TRIAL_NOTICE_DAYS = 3;
/** How long after a trial ends the "your trial has ended" reminder can still go out (the job may have been down that day). */
const TRIAL_AFTER_DAYS = 3;

/** Whether it is time to ask for the next period's payment: shortly before the end, and for as long as the plan's grace period lasts (3 days for a trial). */

export function renewalDue(o: { periodEnd: Date; graceDays: number; now: Date; cancelled: boolean; trial?: boolean }): boolean {
  if (o.cancelled) return false;
  const t = o.now.getTime(), end = o.periodEnd.getTime();
  const before = (o.trial ? TRIAL_NOTICE_DAYS : RENEWAL_NOTICE_DAYS) * 864e5;
  const after = (o.trial ? TRIAL_AFTER_DAYS : o.graceDays) * 864e5;
  return t >= end - before && t <= end + after;
}

/** Whole days left before a period ends, counted up (a period ending in 30 hours has 2 days left); 0 once it has ended. */
export const daysLeft = (periodEnd: Date, now: Date) => Math.max(0, Math.ceil((periodEnd.getTime() - now.getTime()) / 864e5));

/** The reminder sent at each stage, in plain words, for a plan renewal or the end of a free trial. */
export function renewalMessage(o: { planName: string; stage: "NOTICE" | "LAST_DAY" | "OVERDUE"; trial: boolean; days: number; amount: string }): { title: string; body: string } {
  if (o.trial) {
    if (o.stage === "OVERDUE") return { title: `Your free trial of ${o.planName} has ended`, body: `You can still see what you made during the trial. Choose ${o.planName} for ${o.amount} to switch everything back on.` };
    if (o.stage === "LAST_DAY") return { title: `Your free trial of ${o.planName} ends today`, body: `Choose ${o.planName} for ${o.amount} today to keep everything on without a break.` };
    return { title: `Your free trial of ${o.planName} ends in ${o.days} ${o.days === 1 ? "day" : "days"}`, body: `Choose ${o.planName} for ${o.amount} to keep everything you use now.` };
  }
  if (o.stage === "OVERDUE") return { title: `Your ${o.planName} plan has run out`, body: `Pay ${o.amount} now to keep your features.` };
  if (o.stage === "LAST_DAY") return { title: `Your ${o.planName} plan ends today`, body: `Pay ${o.amount} to continue without a break.` };
  return { title: `Your ${o.planName} plan ends in ${o.days} ${o.days === 1 ? "day" : "days"}`, body: `Pay ${o.amount} to continue without a break.` };
}

/** Which reminder stage a renewal invoice is at, so each stage is sent once: advance notice, the last day, overdue. */
export function reminderStage(periodEnd: Date, now: Date): "NOTICE" | "LAST_DAY" | "OVERDUE" {
  const left = periodEnd.getTime() - now.getTime();
  if (left < 0) return "OVERDUE";
  return left <= 864e5 ? "LAST_DAY" : "NOTICE";
}

export type Verdict = { ok: true } | { ok: false; reason: "AMOUNT" | "CURRENCY" | "INVOICE_CLOSED" };

/** Whether a provider's report of money received matches what was asked for. Anything else goes to a person, and nothing is applied. */
export function checkReceived(o: { expectedKobo: bigint; receivedKobo: bigint; currency: string; expectedCurrency?: string; invoiceStatus: "OPEN" | "PAID" | "VOID" }): Verdict {
  if (o.currency.toUpperCase() !== (o.expectedCurrency ?? "NGN").toUpperCase()) return { ok: false, reason: "CURRENCY" };
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

// ---------- Paying yearly ----------

/** The administrator's yearly offer: a year of a monthly plan costs this many months (10 means two months free). 0 or 12 switches it off. */
export const YEARLY_DEFAULT_MONTHS = 10;

/** Whether a plan can be paid yearly: monthly plans only, while the offer is on. */
export const yearlyOffered = (billingPeriod: string, monthsCharged: number) => billingPeriod === "MONTHLY" && monthsCharged >= 1 && monthsCharged < 12;

/** What a year costs, from the monthly price. */
export const yearlyPrice = (monthly: bigint, monthsCharged: number) => monthly * BigInt(monthsCharged);

/** "2 months free", "1 month free": what paying yearly saves, in plain words. */
export const yearlySaving = (monthsCharged: number) => { const free = 12 - monthsCharged; return `${free} ${free === 1 ? "month" : "months"} free`; };
