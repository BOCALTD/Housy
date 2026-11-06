/**
 * Best match: how search results are ordered when there are many to choose from, how a price compares with the area, and
 * when two listings are really the same property. No database here, so every rule can be tested.
 *
 * Every point a listing earns is a plain reason a person can read ("Good price for Lekki", "8 photos", "Verified company").
 * Paid promotion never changes this order; promoted listings are shown separately and labelled.
 */
import { yearlyKobo } from "./market-rules";

export type MatchInput = {
  id: string; companyId: string; publicRef: string;
  purpose: string; pricePeriod: string; priceKobo: bigint; bedrooms: number | null; propertyType: string;
  city: string; estateName: string; lat: number | null; lng: number | null;
  description: string; videoUrl: string; bathrooms: number | null; buildingSqm: number | null; landSqm: number | null;
  furnishing: string; availableFrom: Date | null; publishedAt: Date | null; photos: number;
};

/** What the area usually costs: the median asking price (sale) or yearly rent, in naira, for this kind of home. */
export type AreaPrice = { median: number; n: number } | null;

/** The price as the market pages count it: a sale as it is, a rent as a year's rent (nightly short lets are not compared). */
export function comparableNaira(l: { purpose: string; pricePeriod: string; priceKobo: bigint }): number | null {
  const y = yearlyKobo({ purpose: l.purpose, pricePeriod: l.pricePeriod || null, priceKobo: l.priceKobo });
  return y === null ? null : Number(y) / 100;
}

export type PriceVerdict = { kind: "good" | "fair" | "high"; pct: number };
/**
 * How the price compares with the area: "good" at least 10% under the typical price, "high" 25% or more over it. Needs a
 * typical price built from at least 5 listings, or there is no verdict (a guess would mislead).
 */
export function priceVerdict(priceNaira: number | null, area: AreaPrice): PriceVerdict | null {
  if (priceNaira === null || !area || area.n < 5 || area.median <= 0) return null;
  const pct = Math.round(((priceNaira - area.median) / area.median) * 100);
  return { kind: pct <= -10 ? "good" : pct >= 25 ? "high" : "fair", pct };
}

/** How complete the listing is, out of 30: photos, a real description, a video, the map pin and key details. */
export function completeness(l: MatchInput): { score: number; reasons: string[] } {
  let score = Math.min(l.photos, 8) * 2; // up to 16
  const reasons: string[] = [];
  if (l.photos >= 5) reasons.push(`${l.photos} photos`);
  if (l.description.trim().length >= 300) score += 5;
  if (l.videoUrl) { score += 3; reasons.push("Has a video"); }
  if (l.lat !== null && l.lng !== null) score += 3;
  score += [l.bathrooms, l.buildingSqm ?? l.landSqm, l.furnishing || null, l.availableFrom].filter((x) => x !== null && x !== undefined && x !== "").length * 0.75;
  return { score: Math.min(30, score), reasons };
}

/** Newer listings rank a little higher; the boost halves every 3 weeks, so a good older listing is not buried. */
export function freshness(publishedAt: Date | null, now: Date): number {
  if (!publishedAt) return 0;
  const days = Math.max(0, (now.getTime() - publishedAt.getTime()) / 864e5);
  return 15 * Math.pow(0.5, days / 21);
}

export type Scored<T> = T & { matchScore: number; matchWhy: string[]; verdict: PriceVerdict | null };

/** Order listings for a person: value for the area, how complete and trustworthy the listing is, and how fresh. */
export function bestMatch<T extends MatchInput>(rows: T[], ctx: { now: Date; areaPrice: (l: T) => AreaPrice; trustLevel: (companyId: string) => number; areaName: (l: T) => string }): Scored<T>[] {
  return rows.map((l) => {
    const why: string[] = [];
    const verdict = priceVerdict(comparableNaira(l), ctx.areaPrice(l));
    let score = 0;
    if (verdict) {
      // Under the area's typical price earns up to 25; over it loses up to 20.
      score += verdict.pct < 0 ? Math.min(25, -verdict.pct) : -Math.min(20, verdict.pct / 2);
      if (verdict.kind === "good") why.push(`Good price for ${ctx.areaName(l)}`);
    }
    const c = completeness(l); score += c.score; why.push(...c.reasons);
    const trust = ctx.trustLevel(l.companyId);
    score += Math.min(4, Math.max(0, trust)) * 5; // up to 20
    if (trust >= 2) why.push("Verified company");
    score += freshness(l.publishedAt, ctx.now);
    if (l.publishedAt && ctx.now.getTime() - l.publishedAt.getTime() < 7 * 864e5) why.push("New this week");
    return { ...l, matchScore: Math.round(score * 10) / 10, matchWhy: why.slice(0, 3), verdict };
  }).sort((a, b) => b.matchScore - a.matchScore || (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0) || a.publicRef.localeCompare(b.publicRef));
}

/**
 * When two listings are very likely the same property: same kind, purpose, bedrooms and price band, and the same map spot
 * (within about 100 metres) or the same estate. Without a map pin or an estate name there is not enough to tell, so no key.
 */
export function duplicateKey(l: MatchInput): string | null {
  const place = l.lat !== null && l.lng !== null ? `@${l.lat.toFixed(3)},${l.lng.toFixed(3)}` : l.estateName.trim() ? `estate:${l.estateName.trim().toLowerCase().replace(/\s+/g, " ")}|${l.city.trim().toLowerCase()}` : null;
  if (!place) return null;
  const n = Number(l.priceKobo) / 100;
  if (!(n > 0)) return null;
  // Prices within about 5% of each other fall in the same band.
  const band = Math.round(Math.log(n) / Math.log(1.05));
  return [place, l.propertyType, l.purpose, l.pricePeriod || "-", l.bedrooms ?? "-", band].join("|");
}

/** Keep the best listing of each duplicate group (rows must already be in best-first order) and count the others. */
export function groupDuplicates<T extends MatchInput>(rows: T[]): (T & { alsoListed: { publicRef: string; companyId: string }[] })[] {
  const lead = new Map<string, T & { alsoListed: { publicRef: string; companyId: string }[] }>();
  const out: (T & { alsoListed: { publicRef: string; companyId: string }[] })[] = [];
  for (const r of rows) {
    const k = duplicateKey(r);
    const first = k ? lead.get(k) : undefined;
    if (first) { first.alsoListed.push({ publicRef: r.publicRef, companyId: r.companyId }); continue; }
    const item = { ...r, alsoListed: [] as { publicRef: string; companyId: string }[] };
    if (k) lead.set(k, item);
    out.push(item);
  }
  return out;
}

// ---------- Listings that are no longer confirmed ----------

/** A published listing must be confirmed as still available this often, or it stops showing. */
export const CONFIRM_EVERY_DAYS = 45;
/** The agent is reminded this many days before it stops showing. */
export const CONFIRM_REMIND_DAYS = 7;

export function confirmationState(confirmedAt: Date | null, publishedAt: Date | null, now: Date): { due: Date; state: "ok" | "remind" | "expired" } | null {
  const from = confirmedAt ?? publishedAt;
  if (!from) return null;
  const due = new Date(from.getTime() + CONFIRM_EVERY_DAYS * 864e5);
  const left = (due.getTime() - now.getTime()) / 864e5;
  return { due, state: left <= 0 ? "expired" : left <= CONFIRM_REMIND_DAYS ? "remind" : "ok" };
}
