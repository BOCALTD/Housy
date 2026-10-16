// Pure rules for perks tiers, promotions, ranking and the rating prompt.

export type TierName = "BASIC" | "SILVER" | "GOLD";
export const TIERS: readonly TierName[] = ["BASIC", "SILVER", "GOLD"];

export interface Perks { label: string; goldBadge: boolean; premiumTag: boolean; autoBoost: boolean; freePromos: boolean; summary: string }
const PERKS: Record<TierName, Perks> = {
  BASIC: { label: "Basic", goldBadge: false, premiumTag: false, autoBoost: false, freePromos: false, summary: "Free. Promotions are charged per property." },
  SILVER: { label: "Silver", goldBadge: false, premiumTag: false, autoBoost: false, freePromos: true, summary: "Promotions are free." },
  GOLD: { label: "Gold", goldBadge: true, premiumTag: true, autoBoost: true, freePromos: true, summary: "Golden badge, Premium tag on every listing, automatic boost, and free promotions." },
};
export const tierPerks = (t: TierName): Perks => PERKS[t];

/** The tier a company has at a moment: what its subscription earned, until that subscription's period ends. */
export function effectiveTier(row: { tier: TierName; validUntil: Date } | null | undefined, now: Date): TierName {
  return row && row.validUntil.getTime() > now.getTime() ? row.tier : "BASIC";
}

/** What a company pays to put n properties in a campaign. */
export function promoFee(tier: TierName, perPropertyKobo: bigint, n: number): bigint {
  return PERKS[tier].freePromos ? 0n : perPropertyKobo * BigInt(Math.max(0, n));
}

export const discountPct = (original: bigint, promo: bigint): number => (original <= 0n ? 0 : Number(((original - promo) * 1000n) / original) / 10);

/** Why a promotional price is not acceptable, or null. The original must be the price the property is really listed at. */
export function promoPriceProblem(original: bigint, promo: bigint, maxDiscountPct: number): string | null {
  if (promo <= 0n) return "Enter the promotional price.";
  if (promo >= original) return "The promotional price must be lower than the listed price.";
  if (discountPct(original, promo) > maxDiscountPct) return `This campaign allows at most ${maxDiscountPct}% off. A bigger cut usually means the listed price was inflated.`;
  return null;
}

export interface LivePromoFacts {
  entryStatus: "REQUESTED" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  campaign: { active: boolean; startsOn: Date; endsOn: Date };
  listingStatus: string; listingPriceKobo: bigint; originalPriceKobo: bigint;
  now: Date;
}
/** A promotion is shown only while it is approved, inside its dates, the property is published, and the listed price is still the one it was approved against. */
export function promoLive(f: LivePromoFacts): boolean {
  return f.entryStatus === "APPROVED" && f.campaign.active && f.now >= f.campaign.startsOn && f.now.getTime() < f.campaign.endsOn.getTime() + 864e5
    && f.listingStatus === "PUBLISHED" && f.listingPriceKobo === f.originalPriceKobo;
}
export function promoStaleReason(f: LivePromoFacts): string | null {
  if (f.entryStatus !== "APPROVED") return null;
  if (f.listingPriceKobo !== f.originalPriceKobo) return "The listed price changed after approval, so the promotion is paused.";
  if (f.listingStatus !== "PUBLISHED") return "The property is not published.";
  if (f.now.getTime() >= f.campaign.endsOn.getTime() + 864e5) return "The campaign has ended.";
  if (f.now < f.campaign.startsOn) return "The campaign has not started.";
  if (!f.campaign.active) return "The campaign was ended early.";
  return null;
}

// ---------- Ranking ----------

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/**
 * Order a page of results. Gold companies' listings are lifted so that one of every three places goes to a Gold listing, while there are
 * any, and Gold listings take turns day by day instead of the same one always sitting first. Everything else keeps its order.
 */
export function rankListings<T extends { id: string }>(items: T[], isGold: (item: T) => boolean, daySeed: string): T[] {
  const gold = items.filter(isGold).sort((a, b) => hashSeed(`${daySeed}:${a.id}`) - hashSeed(`${daySeed}:${b.id}`));
  const rest = items.filter((i) => !isGold(i));
  const out: T[] = [];
  while (gold.length || rest.length) {
    if (gold.length) out.push(gold.shift()!);
    for (let i = 0; i < 2; i++) if (rest.length) out.push(rest.shift()!); else if (gold.length) out.push(gold.shift()!);
  }
  return out;
}

// ---------- The rating prompt ----------

export const DEFAULT_RATING_INTERVAL_DAYS = 30;
export const SNOOZE_DAYS = 7;
/** Ask again once the interval has passed since they last rated, or since they joined if they never have, unless they asked to be reminded later. */
export function ratingDue(o: { accountCreatedAt: Date; lastRatedAt: Date | null; snoozedUntil: Date | null; intervalDays: number; now: Date }): boolean {
  if (o.snoozedUntil && o.snoozedUntil.getTime() > o.now.getTime()) return false;
  const since = o.lastRatedAt ?? o.accountCreatedAt;
  return o.now.getTime() - since.getTime() >= o.intervalDays * 864e5;
}
