/**
 * Money in the verification network (stage 7): the price Housy quotes a customer, Housy's fee and the provider's share,
 * when a provider's earning can be paid out, and payouts. Pure rules, used by the services and tested on their own.
 */
import { checkBankDetails } from "./regions";

/** Housy's fee, in basis points of the customer's price (1500 = 15%). Fixed on each case when it is quoted. */
export const PLATFORM_FEE_BPS = 1500;
/** Days after delivery before an earning can be paid out, unless the customer confirms sooner. A dispute holds it. */
export const PAYOUT_WAIT_DAYS = 7;
/** Smallest and largest price Housy can quote for one case, in kobo (₦5,000 to ₦50,000,000). */
export const MIN_PRICE_KOBO = 500_000n;
export const MAX_PRICE_KOBO = 5_000_000_000n;

/** Split a price into Housy's fee and the provider's share. The fee is rounded to the nearest kobo (halves up); the two always add up to the price. */
export function splitPrice(priceKobo: bigint, feeBps = PLATFORM_FEE_BPS): { feeKobo: bigint; netKobo: bigint } {
  if (priceKobo <= 0n) throw new Error("The price must be more than nothing.");
  if (feeBps < 0 || feeBps > 10_000 || !Number.isInteger(feeBps)) throw new Error("The fee must be between 0% and 100%.");
  const feeKobo = (priceKobo * BigInt(feeBps) + 5_000n) / 10_000n;
  return { feeKobo, netKobo: priceKobo - feeKobo };
}

export const EARNING_STATUSES = ["PENDING", "HELD", "PAYABLE", "IN_PAYOUT", "PAID", "VOID"] as const;
export type EarningStatus = (typeof EARNING_STATUSES)[number];
export const EARNING_WORDS: Record<EarningStatus, string> = {
  PENDING: "Waiting for the customer", HELD: "Held", PAYABLE: "Ready to pay out", IN_PAYOUT: "In a payout", PAID: "Paid", VOID: "Cancelled",
};

/** Allowed moves of an earning. Paid and cancelled are final. The database enforces the same moves. */
export const EARNING_MOVES: [EarningStatus, EarningStatus][] = [
  ["PENDING", "PAYABLE"], ["PENDING", "HELD"], ["PENDING", "VOID"],
  ["HELD", "PENDING"], ["HELD", "PAYABLE"], ["HELD", "VOID"],
  ["PAYABLE", "HELD"], ["PAYABLE", "IN_PAYOUT"],
  ["IN_PAYOUT", "PAYABLE"], ["IN_PAYOUT", "PAID"],
];
export const canMoveEarning = (from: EarningStatus, to: EarningStatus) => EARNING_MOVES.some(([a, b]) => a === from && b === to);

/** When a delivered report's earning becomes payable if nobody disputes it. */
export const payableFrom = (deliveredAt: Date) => new Date(deliveredAt.getTime() + PAYOUT_WAIT_DAYS * 86_400_000);

/** Payout references: HVO-YYYY-NNNNNN. */
export const payoutRef = (year: number, n: number) => `HVO-${year}-${String(n).padStart(6, "0")}`;

/** A Nigerian bank account (NUBAN) is ten digits. */
/**
 * Whether a payout account is complete. In Nigeria: bank, account name and the 10-digit NUBAN. Elsewhere: the details that
 * country's banks need (a sort code in the UK, a routing number in the US, an IBAN in Europe…), kept in bank_details.
 */
export function payoutDetailsProblem(d: { bankName: string; accountName: string; accountNumber: string; country?: string; bankDetails?: unknown }): string | null {
  if (d.country && d.country !== "NG") {
    const details = d.bankDetails && typeof d.bankDetails === "object" ? (d.bankDetails as Record<string, string>) : {};
    const r = checkBankDetails(d.country, details);
    return r.ok ? null : r.problem;
  }
  if (d.bankName.trim().length < 2) return "Enter the bank's name.";
  if (d.accountName.trim().length < 2) return "Enter the account name exactly as the bank shows it.";
  if (!/^\d{10}$/.test(d.accountNumber.replace(/\s+/g, ""))) return "The account number must be the 10-digit NUBAN.";
  return null;
}
export const maskAccount = (n: string) => (n.length >= 4 ? `•••••• ${n.slice(-4)}` : n);

/** The rate a payout abroad was made at, in words: "₦1,580.25 to $1". */
export function payoutRate(nairaKobo: bigint, sentMinor: bigint, currency: string): string {
  if (sentMinor <= 0n) return "";
  const perUnit = (nairaKobo * 100n) / sentMinor; // naira per 1 unit of the currency, in hundredths
  const whole = perUnit / 100n, frac = perUnit % 100n;
  return `₦${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac.toString().padStart(2, "0").slice(0, 2)} to 1 ${currency}`;
}
