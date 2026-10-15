import { addMonthsClamped } from "./dates";

export type Frequency = "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "YEARLY" | "CUSTOM";

export const FREQUENCY_MONTHS: Record<Exclude<Frequency, "CUSTOM">, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  HALF_YEARLY: 6,
  YEARLY: 12,
};

/** Months between rent due dates. A custom frequency needs an explicit interval of 1 to 120 months. */
export function periodMonths(frequency: Frequency, intervalMonths?: number | null): number {
  if (frequency === "CUSTOM") {
    if (!intervalMonths || !Number.isInteger(intervalMonths) || intervalMonths < 1 || intervalMonths > 120) {
      throw new Error("Enter a custom payment interval of 1 to 120 months");
    }
    return intervalMonths;
  }
  return FREQUENCY_MONTHS[frequency];
}

export type ScheduledCharge = { dueDate: Date; amountKobo: bigint };

/**
 * Generate rent charges from an approved agreement (master prompt Section 12.2).
 * Rent is payable in advance at the start of each period. `rentKobo` is the amount per period.
 * Due dates are always computed from the start date (start + n periods), so month-end dates do not drift.
 * The end date is exclusive: no charge falls due on or after it.
 */
export function generateRentSchedule(opts: {
  startDate: Date;
  endDate: Date;
  frequency: Frequency;
  rentKobo: bigint;
  intervalMonths?: number | null;
}): ScheduledCharge[] {
  const { startDate, endDate, frequency, rentKobo } = opts;
  if (endDate <= startDate) throw new Error("The lease end date must be after the start date");
  if (rentKobo <= 0n) throw new Error("Rent must be more than zero");
  const step = periodMonths(frequency, opts.intervalMonths);
  const charges: ScheduledCharge[] = [];
  for (let n = 0; ; n++) {
    const due = addMonthsClamped(startDate, n * step);
    if (due >= endDate) break;
    charges.push({ dueDate: due, amountKobo: rentKobo });
    if (n > 1200) throw new Error("Lease is too long to schedule");
  }
  return charges;
}

type Money = { amountKobo: bigint; adjustedKobo?: bigint; paidKobo: bigint };

/** What is owed on a charge after approved adjustments (late fees add, waivers and credit notes subtract). */
export function effectiveAmount(c: { amountKobo: bigint; adjustedKobo?: bigint }): bigint {
  return c.amountKobo + (c.adjustedKobo ?? 0n);
}

/** What is still unpaid on a charge. Never negative. */
export function outstandingOf(c: Money): bigint {
  const o = effectiveAmount(c) - c.paidKobo;
  return o > 0n ? o : 0n;
}

/** The last day a payment is on time: the due date plus the grace period in the lease. */
export function lastOnTimeDay(dueDate: Date, graceDays: number): Date {
  return new Date(dueDate.getTime() + graceDays * 864e5);
}

export type ChargeState = "PAID" | "WAIVED" | "PART_PAID" | "DUE" | "OVERDUE";

/**
 * Overdue starts the day after the grace period ends. A fully waived charge is WAIVED, not paid.
 * A notification or reminder never changes this: only recorded, evidenced payments do.
 */
export function chargeState(c: Money & { dueDate: Date }, today: Date, graceDays = 0): ChargeState {
  const effective = effectiveAmount(c);
  if (effective <= 0n) return "WAIVED";
  if (c.paidKobo >= effective) return "PAID";
  if (lastOnTimeDay(c.dueDate, graceDays) < today) return "OVERDUE";
  if (c.paidKobo > 0n) return "PART_PAID";
  return "DUE";
}

/** Whole days a charge is past its grace period, or 0 if it is not overdue. */
export function daysOverdue(c: Money & { dueDate: Date }, today: Date, graceDays = 0): number {
  if (outstandingOf(c) <= 0n) return 0;
  const days = Math.floor((today.getTime() - lastOnTimeDay(c.dueDate, graceDays).getTime()) / 864e5);
  return days > 0 ? days : 0;
}

/** Validate a payment against a charge and return the new paid total. Overpayment is rejected. */
export function applyPayment(c: Money, paymentKobo: bigint): bigint {
  if (paymentKobo <= 0n) throw new Error("Payment must be more than zero");
  const outstanding = effectiveAmount(c) - c.paidKobo;
  if (outstanding <= 0n) throw new Error("This charge is already fully paid");
  if (paymentKobo > outstanding) throw new Error("Payment is more than the amount outstanding on this charge");
  return c.paidKobo + paymentKobo;
}
