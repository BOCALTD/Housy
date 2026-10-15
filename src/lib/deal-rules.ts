/** Pure rules for the deal (transaction) pipeline. No database access. */

export const DEAL_TYPES = ["SALE", "RENT", "LEASE"] as const;
export const DEAL_STAGES = ["ENQUIRY", "VIEWING", "OFFER", "NEGOTIATION", "AGREED", "LEGAL", "COMPLETED"] as const;
export const DEAL_STATUSES = ["OPEN", "ON_HOLD", "DISPUTED", "COMPLETED", "CANCELLED"] as const;
export const VIEWING_STATUSES = ["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"] as const;
export const OFFER_SIDES = ["CLIENT", "OWNER"] as const;
export const OFFER_STATUSES = ["OPEN", "COUNTERED", "REJECTED", "WITHDRAWN", "ACCEPTANCE_REQUESTED", "ACCEPTED"] as const;

export type DealStage = (typeof DEAL_STAGES)[number];
export type DealStatus = (typeof DEAL_STATUSES)[number];

const idx = (s: DealStage) => DEAL_STAGES.indexOf(s);

/**
 * Moving a deal by hand. Forward one step at a time between enquiry and negotiation, and from agreed into legal. Reaching
 * "agreed" is done only by approving an accepted offer, and "completed" only by completing the deal with a second person.
 * Going back is allowed between enquiry and negotiation, with a reason.
 */
export function stageMoveProblem(from: DealStage, to: DealStage, status: DealStatus, reason: string): string | null {
  if (status !== "OPEN") return `A deal that is ${status.toLowerCase().replace("_", " ")} cannot change stage`;
  if (from === to) return "The deal is already at that stage";
  if (to === "AGREED") return "A deal becomes agreed when an offer is accepted and approved";
  if (to === "COMPLETED") return "A deal is completed with the completion step, which needs a second person";
  if (idx(to) > idx(from)) {
    if (idx(to) !== idx(from) + 1) return "Move the deal one stage at a time";
    if (from === "NEGOTIATION") return "A deal moves from negotiation to agreed when an offer is accepted and approved";
    return null;
  }
  if (idx(from) >= idx("AGREED")) return "Once a price is agreed, reopen the negotiation to go back";
  if (reason.trim().length < 3) return "Say why the deal is going back a stage";
  return null;
}

/** Appointments are in Lagos time (UTC+1, no daylight saving). Returns the instant as a Date. */
export function lagosToUtc(date: string, time: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const t = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m || !t) throw new Error("Enter the viewing date and time");
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [h, mi] = [Number(t[1]), Number(t[2])];
  if (h > 23 || mi > 59) throw new Error("Enter a valid time");
  const dt = new Date(Date.UTC(y, mo - 1, d, h - 1, mi));
  const back = new Date(Date.UTC(y, mo - 1, d));
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) throw new Error("Enter a real date");
  return dt;
}

export interface Slot { startsAt: Date; endsAt: Date }
export function overlaps(a: Slot, b: Slot): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.endsAt.getTime();
}

export function slotProblem(slot: Slot, now: Date): string | null {
  const minutes = (slot.endsAt.getTime() - slot.startsAt.getTime()) / 60000;
  if (!(minutes >= 10 && minutes <= 480)) return "A viewing lasts between 10 minutes and 8 hours";
  if (slot.startsAt.getTime() < now.getTime() - 60_000) return "A viewing cannot be booked in the past";
  return null;
}

/** An offer can be accepted only while open, and not after its validity date. */
export function offerAcceptable(o: { status: string; validUntil: Date | null }, today: Date): string | null {
  if (o.status !== "OPEN") return "Only an open offer can be accepted";
  if (o.validUntil && o.validUntil.getTime() < today.getTime()) return "This offer has expired";
  return null;
}

/** Percentage difference of an offer from asking, in basis points (negative = below asking). */
export function offerGapBps(askingKobo: bigint, offerKobo: bigint): number {
  if (askingKobo <= 0n) return 0;
  const diff = (offerKobo - askingKobo) * 10000n;
  const q = diff / askingKobo;
  const r = diff % askingKobo;
  return Number(r * 2n >= askingKobo ? q + 1n : r * 2n <= -askingKobo ? q - 1n : q);
}
