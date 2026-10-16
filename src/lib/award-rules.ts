// Pure rules for the monthly Top Agent ranking. Given the same facts and settings the result is always the same, which is what
// lets a published ranking be reproduced from what was recorded. Paid plans, promotions and sponsored views are not inputs.

export const PLAQUES = ["GOLD", "DIAMOND", "SILVER"] as const;
export type Plaque = (typeof PLAQUES)[number];
export const PLAQUE_LABEL: Record<Plaque, string> = { GOLD: "Gold Plaque", DIAMOND: "Diamond Plaque", SILVER: "Silver Plaque" };

export interface AwardConfig {
  weights: { sales: number; posts: number; rating: number };
  minSales: number; minPosts: number; minReviews: number;
  windowDays: number;
  completedDays: number;
}
export const DEFAULT_AWARD_CONFIG: AwardConfig = { weights: { sales: 34, posts: 33, rating: 33 }, minSales: 1, minPosts: 1, minReviews: 3, windowDays: 7, completedDays: 90 };

export function configProblem(c: AwardConfig): string | null {
  const w = c.weights;
  for (const v of [w.sales, w.posts, w.rating]) if (!Number.isInteger(v) || v < 0 || v > 100) return "Each weight must be a whole number from 0 to 100";
  if (w.sales + w.posts + w.rating !== 100) return "The three weights must add up to 100";
  for (const [k, v, max] of [["Minimum sales", c.minSales, 1000], ["Minimum posts", c.minPosts, 1000], ["Minimum reviews", c.minReviews, 1000], ["Correction window (days)", c.windowDays, 60], ["Completed-deal display (days)", c.completedDays, 730]] as const) {
    if (!Number.isInteger(v) || v < 0 || v > max) return `${k} must be a whole number from 0 to ${max}`;
  }
  if (c.completedDays < 1) return "Completed-deal display must be at least 1 day";
  return null;
}

export interface AgentMonthFacts {
  userId: string; displayName: string; companyName: string; since: string;
  sales: number; posts: number; ratings: number[];
}
export interface AwardResult {
  userId: string; displayName: string; companyName: string;
  eligible: boolean; reason: string;
  sales: number; posts: number; reviews: number; avgRating: number; ratingScore: number;
  normSales: number; normPosts: number; normRating: number;
  score: number; rank: number | null; plaque: Plaque | null;
}

export const PRIOR_MEAN = 3.5;
export const PRIOR_WEIGHT = 3;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Average rating pulled toward a neutral prior so two perfect reviews do not beat thirty strong ones. */
export function ratingScore(ratings: number[]): number {
  if (!ratings.length) return 0;
  return (PRIOR_WEIGHT * PRIOR_MEAN + ratings.reduce((a, b) => a + b, 0)) / (PRIOR_WEIGHT + ratings.length);
}

export function rankAgents(facts: AgentMonthFacts[], cfg: AwardConfig): AwardResult[] {
  const base: AwardResult[] = facts.map((f) => {
    const reasons: string[] = [];
    if (f.sales < cfg.minSales) reasons.push(`needs at least ${cfg.minSales} verified ${cfg.minSales === 1 ? "sale" : "sales"}`);
    if (f.posts < cfg.minPosts) reasons.push(`needs at least ${cfg.minPosts} ${cfg.minPosts === 1 ? "post" : "posts"}`);
    if (f.ratings.length < cfg.minReviews) reasons.push(`needs at least ${cfg.minReviews} reviews`);
    return {
      userId: f.userId, displayName: f.displayName, companyName: f.companyName, eligible: reasons.length === 0, reason: reasons.join("; "),
      sales: f.sales, posts: f.posts, reviews: f.ratings.length, avgRating: f.ratings.length ? Math.round((f.ratings.reduce((a, b) => a + b, 0) / f.ratings.length) * 10) / 10 : 0,
      ratingScore: r2(ratingScore(f.ratings)), normSales: 0, normPosts: 0, normRating: 0, score: 0, rank: null, plaque: null,
    };
  });
  const eligible = base.filter((r) => r.eligible);
  const maxSales = Math.max(0, ...eligible.map((r) => r.sales)), maxPosts = Math.max(0, ...eligible.map((r) => r.posts));
  const w = cfg.weights;
  for (const r of eligible) {
    r.normSales = maxSales ? r2(r.sales / maxSales) : 0;
    r.normPosts = maxPosts ? r2(r.posts / maxPosts) : 0;
    r.normRating = r2((ratingScore(facts.find((f) => f.userId === r.userId)!.ratings) - 1) / 4);
    r.score = r2(w.sales * r.normSales + w.posts * r.normPosts + w.rating * r.normRating);
  }
  const since = new Map(facts.map((f) => [f.userId, f.since]));
  eligible.sort((a, b) => b.score - a.score || b.sales - a.sales || b.ratingScore - a.ratingScore || b.reviews - a.reviews || (since.get(a.userId)! < since.get(b.userId)! ? -1 : since.get(a.userId)! > since.get(b.userId)! ? 1 : 0) || (a.userId < b.userId ? -1 : 1));
  eligible.forEach((r, i) => { r.rank = i + 1; r.plaque = PLAQUES[i] ?? null; });
  return [...eligible, ...base.filter((r) => !r.eligible).sort((a, b) => (a.userId < b.userId ? -1 : 1))];
}

// ---------- Months (Lagos is UTC+1 all year) ----------

export const monthKey = (d: Date): string => { const l = new Date(d.getTime() + 36e5); return `${l.getUTCFullYear()}-${String(l.getUTCMonth() + 1).padStart(2, "0")}`; };
export function monthRange(month: string): { start: Date; end: Date } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m || +m[2] < 1 || +m[2] > 12) throw new Error("Use a month like 2026-09");
  const y = +m[1], mo = +m[2];
  return { start: new Date(Date.UTC(y, mo - 1, 1) - 36e5), end: new Date(Date.UTC(y, mo, 1) - 36e5) };
}
export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthLabel = (month: string): string => { const { start } = monthRange(month); const l = new Date(start.getTime() + 36e5); return `${MONTH_NAMES[l.getUTCMonth()]} ${l.getUTCFullYear()}`; };
/** A month can be ranked only once it has finished. */
export const monthEnded = (month: string, now: Date): boolean => now.getTime() >= monthRange(month).end.getTime();
/** The correction period runs from publication; the ranking may be frozen once it is over. */
export const windowOver = (publishedAt: Date, windowDays: number, now: Date): boolean => now.getTime() >= publishedAt.getTime() + windowDays * 864e5;
