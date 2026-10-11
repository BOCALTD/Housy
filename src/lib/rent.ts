import { addMonthsClamped } from "./dates";

export type Frequency = "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "YEARLY";

export const FREQUENCY_MONTHS: Record<Frequency, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  HALF_YEARLY: 6,
  YEARLY: 12,
};

export type ScheduledCharge = { dueDate: Date; amountKobo: bigint };

/**
 * Generate rent charges from an approved agreement (master prompt Section 12.2).
 * Rent is payable in advance at the start of each period. `rentKobo` is the amount per period.
 * Due dates are always computed from the start date (start + n periods), so month-end dates do not drift.
 */
export function generateRentSchedule(opts: {
  startDate: Date;
  endDate: Date;
  frequency: Frequency;
  rentKobo: bigint;
}): ScheduledCharge[] {
  const { startDate, endDate, frequency, rentKobo } = opts;
  if (endDate <= startDate) throw new Error("The lease end date must be after the start date");
  if (rentKobo <= 0n) throw new Error("Rent must be more than zero");
  const step = FREQUENCY_MONTHS[frequency];
  const charges: ScheduledCharge[] = [];
  for (let n = 0; ; n++) {
    const due = addMonthsClamped(startDate, n * step);
    if (due >= endDate) break;
    charges.push({ dueDate: due, amountKobo: rentKobo });
    if (n > 1200) throw new Error("Lease is too long to schedule");
  }
  return charges;
}

export type ChargeState = "PAID" | "PART_PAID" | "DUE" | "OVERDUE";

export function chargeState(c: { amountKobo: bigint; paidKobo: bigint; dueDate: Date }, today: Date): ChargeState {
  if (c.paidKobo >= c.amountKobo) return "PAID";
  if (c.dueDate < today) return "OVERDUE";
  if (c.paidKobo > 0n) return "PART_PAID";
  return "DUE";
}

/** Validate a payment against a charge and return the new paid total. Overpayment is rejected. */
export function applyPayment(c: { amountKobo: bigint; paidKobo: bigint }, paymentKobo: bigint): bigint {
  if (paymentKobo <= 0n) throw new Error("Payment must be more than zero");
  const outstanding = c.amountKobo - c.paidKobo;
  if (outstanding <= 0n) throw new Error("This charge is already fully paid");
  if (paymentKobo > outstanding) throw new Error("Payment is more than the amount outstanding on this charge");
  return c.paidKobo + paymentKobo;
}
