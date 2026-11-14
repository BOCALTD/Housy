/**
 * Payments from clients to companies and agents through Housy: rent, inspection fees and other amounts. Housy's commission is a
 * percentage set by the platform administrator, fixed on each payment when it is requested. Pure rules, tested on their own.
 */
import { randomBytes } from "node:crypto";

export const CLIENT_PAYMENT_KINDS = ["RENT", "INSPECTION", "OTHER"] as const;
export type ClientPaymentKind = (typeof CLIENT_PAYMENT_KINDS)[number];
export const CLIENT_PAYMENT_STATUSES = ["PENDING", "PAID", "CANCELLED"] as const;
export type ClientPaymentStatus = (typeof CLIENT_PAYMENT_STATUSES)[number];
export const KIND_WORDS: Record<ClientPaymentKind, string> = { RENT: "Rent", INSPECTION: "Inspection fee", OTHER: "Payment" };

/** Housy's share of an amount: rounded to the nearest kobo (halves up), always less than the whole. */
export function commissionOf(amountKobo: bigint, bps: number): bigint {
  if (amountKobo <= 0n) throw new Error("The amount must be more than nothing.");
  if (!Number.isInteger(bps) || bps < 0 || bps > 5000) throw new Error("The commission must be between 0% and 50%.");
  const c = (amountKobo * BigInt(bps) + 5_000n) / 10_000n;
  return c >= amountKobo ? amountKobo - 1n : c;
}

/** A payment reference, unique and unguessable: CP- then 16 letters and digits. Paystack references allow these characters. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const clientPaymentRef = () => `CP-${[...randomBytes(16)].map((b) => ALPHABET[b % 32]).join("")}`;
export const isClientPaymentRef = (r: string) => /^CP-[A-Z2-9]{16}$/.test(r);

/** The commission invoices cover whole calendar months in Lagos time: the month before `now`. */
export function previousMonth(now: Date): { from: Date; to: Date; label: string } {
  const lagos = new Date(now.getTime() + 3_600_000);
  const y = lagos.getUTCFullYear(), m = lagos.getUTCMonth();
  const from = new Date(Date.UTC(y, m - 1, 1) - 3_600_000);
  const to = new Date(Date.UTC(y, m, 1) - 3_600_000);
  const label = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  return { from, to, label };
}

/** A Nigerian bank account number (NUBAN) is ten digits. */
export const nubanProblem = (n: string) => (/^\d{10}$/.test(n.replace(/\s+/g, "")) ? null : "The account number must be the 10-digit NUBAN.");
