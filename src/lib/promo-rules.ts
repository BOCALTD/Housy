// Promo codes for plans, kept free of the database so the arithmetic can be tested on its own.

export type PromoLike = {
  code: string; percentOff: number | null; amountOffMinor: bigint | null; currency: string; planIds: string[];
  maxRedemptions: number | null; startsAt: Date | null; endsAt: Date | null; active: boolean;
};

/** Codes are typed in any case, with or without spaces or dashes: SUMMER-25, summer 25 and SUMMER25 are the same code. */
export const normaliseCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 30);

/** Why a code cannot be used for this plan right now, or null when it can. */
export function promoProblem(p: PromoLike, o: { planId: string; currency: string; used: number; now: Date }): string | null {
  if (!p.active) return "That code is no longer active";
  if (p.startsAt && o.now < p.startsAt) return "That code cannot be used yet";
  if (p.endsAt && o.now > p.endsAt) return "That code has expired";
  if (p.planIds.length && !p.planIds.includes(o.planId)) return "That code is not for this plan";
  if (p.maxRedemptions != null && o.used >= p.maxRedemptions) return "That code has been used up";
  if (p.amountOffMinor != null && p.currency !== o.currency) return `That code is for prices in ${p.currency}`;
  return null;
}

/** What a code takes off a price (never more than the price), and what is left to pay. */
export function applyPromo(p: Pick<PromoLike, "percentOff" | "amountOffMinor">, price: bigint): { discount: bigint; pay: bigint } {
  let discount = 0n;
  if (p.percentOff != null) discount = (price * BigInt(Math.max(0, Math.min(100, p.percentOff)))) / 100n;
  else if (p.amountOffMinor != null) discount = p.amountOffMinor;
  if (discount > price) discount = price;
  if (discount < 0n) discount = 0n;
  return { discount, pay: price - discount };
}
