/**
 * Personal suggestions from what someone does on the platform: the cities, kinds of property, sizes, prices, agents and
 * companies they keep coming back to. Recent and stronger actions count more (asking about a property counts more than
 * glancing at it). Every suggestion says why it is shown. Pure, tested on its own.
 */
import { yearlyKobo } from "./market-rules";

export const SIGNAL_KINDS = ["PROPERTY_VIEW", "PROPERTY_SAVE", "ENQUIRY", "INSPECTION", "AGENT_VIEW", "SEARCH", "REEL_WATCH", "REEL_LIKE", "REEL_SAVE"] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];
export const SIGNAL_LABEL: Record<SignalKind, string> = {
  PROPERTY_VIEW: "Viewed a property", PROPERTY_SAVE: "Saved a property", ENQUIRY: "Asked about a property", INSPECTION: "Booked an inspection",
  AGENT_VIEW: "Looked at an agent", SEARCH: "Searched", REEL_WATCH: "Watched a reel", REEL_LIKE: "Liked a reel", REEL_SAVE: "Saved a reel",
};
const WEIGHT: Record<SignalKind, number> = { PROPERTY_VIEW: 1, PROPERTY_SAVE: 4, ENQUIRY: 5, INSPECTION: 6, AGENT_VIEW: 1, SEARCH: 1.5, REEL_WATCH: 0.5, REEL_LIKE: 2, REEL_SAVE: 3 };
export const HALF_LIFE_DAYS = 30;
export const KEEP_DAYS = 180;

export type Signal = { kind: string; city: string; propertyType: string; purpose: string; priceKobo: bigint | null; bedrooms: number | null; agentId: string | null; companyId: string | null; listingId: string | null; createdAt: Date };
type Tally = Map<string, number>;
export type Taste = { cities: Tally; types: Tally; purposes: Tally; beds: Tally; agents: Tally; companies: Tally; price: Map<string, number>; total: number; seen: Set<string>; asked: Set<string> };

const add = (m: Tally, k: string | null | undefined, w: number) => { if (k) m.set(k, (m.get(k) ?? 0) + w); };
const top = (m: Tally) => [...m].sort((a, b) => b[1] - a[1]);

/** Weighted median, so one very expensive glance does not drag the price someone looks at. */
function weightedMedian(xs: { v: number; w: number }[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a.v - b.v), half = s.reduce((t, x) => t + x.w, 0) / 2;
  let acc = 0;
  for (const x of s) { acc += x.w; if (acc >= half) return x.v; }
  return s.at(-1)!.v;
}

export function tasteOf(signals: Signal[], now = new Date()): Taste {
  const t: Taste = { cities: new Map(), types: new Map(), purposes: new Map(), beds: new Map(), agents: new Map(), companies: new Map(), price: new Map(), total: 0, seen: new Set(), asked: new Set() };
  const prices = new Map<string, { v: number; w: number }[]>();
  for (const s of signals) {
    const age = (now.getTime() - s.createdAt.getTime()) / 864e5;
    if (age > KEEP_DAYS) continue;
    const w = (WEIGHT[s.kind as SignalKind] ?? 0) * Math.pow(0.5, Math.max(0, age) / HALF_LIFE_DAYS);
    if (w <= 0) continue;
    t.total += w;
    add(t.cities, s.city.trim().toLowerCase(), w);
    add(t.types, s.propertyType, w);
    add(t.purposes, s.purpose, w);
    if (s.bedrooms !== null) add(t.beds, String(Math.min(5, s.bedrooms)), w);
    add(t.agents, s.agentId, w);
    add(t.companies, s.companyId, w);
    if (s.listingId) { t.seen.add(s.listingId); if (s.kind === "ENQUIRY" || s.kind === "INSPECTION") t.asked.add(s.listingId); }
    if (s.priceKobo !== null && s.purpose) {
      const y = yearlyKobo({ purpose: s.purpose, pricePeriod: null, priceKobo: s.priceKobo });
      if (y !== null) { const a = prices.get(s.purpose) ?? []; a.push({ v: Number(y), w }); prices.set(s.purpose, a); }
    }
  }
  for (const [p, xs] of prices) { const m = weightedMedian(xs); if (m !== null) t.price.set(p, m); }
  return t;
}

export type Candidate = { id: string; city: string; propertyType: string; purpose: string; pricePeriod: string | null; priceKobo: bigint; bedrooms: number | null; postedById: string | null; companyId: string; publishedAt: Date | null };

const share = (m: Tally, k: string | null | undefined) => { if (!k) return 0; const total = [...m.values()].reduce((a, b) => a + b, 0); return total ? (m.get(k) ?? 0) / total : 0; };

/** How well a property fits someone's taste, from 0, with the reasons in plain words. */
export function scoreListing(c: Candidate, t: Taste, labels: { type?: (code: string) => string } = {}): { score: number; why: string[] } {
  const why: string[] = [];
  let score = 0;
  if (t.asked.has(c.id)) return { score: 0, why }; // already asked about: no need to suggest it again
  // Someone renting is not shown homes for sale, and the other way round.
  if (t.purposes.size && share(t.purposes, c.purpose) === 0) return { score: 0, why };
  const city = c.city.trim().toLowerCase();
  const cs = share(t.cities, city);
  if (cs > 0) { score += 3 * cs + 0.6; why.push(`In ${c.city}, where you have been looking`); }
  const ps = share(t.purposes, c.purpose);
  if (ps > 0) score += 1.5 * ps; else if (t.purposes.size) score -= 1.5;
  const ts = share(t.types, c.propertyType);
  if (ts > 0) { score += 1.5 * ts; if (ts >= 0.3) why.push(`A ${(labels.type?.(c.propertyType) ?? c.propertyType.toLowerCase().replace(/_/g, " ")).toLowerCase()}, like others you looked at`); }
  if (c.bedrooms !== null) {
    const b = Math.min(5, c.bedrooms);
    const near = share(t.beds, String(b)) + 0.5 * (share(t.beds, String(b - 1)) + share(t.beds, String(b + 1)));
    score += 1.2 * near;
    if (share(t.beds, String(b)) >= 0.3) why.push(`${b === 5 ? "5 or more" : b} bedroom${b === 1 ? "" : "s"}, the size you look at most`);
  }
  const want = t.price.get(c.purpose);
  const y = yearlyKobo({ purpose: c.purpose, pricePeriod: c.pricePeriod, priceKobo: c.priceKobo });
  if (want && y !== null) {
    const r = Number(y) / want;
    if (r >= 0.65 && r <= 1.35) { score += 1.5 * (1 - Math.abs(1 - r) / 0.35); why.push("Close to the prices you have been looking at"); }
    else if (r > 2 || r < 0.35) score -= 1;
  }
  const ag = share(t.agents, c.postedById), co = share(t.companies, c.companyId);
  if (ag > 0 || co > 0) { score += 1.5 * Math.max(ag, co) + 0.4; why.push(ag > 0 ? "Listed by an agent you have looked at" : "From a company you have looked at"); }
  // Somewhere they have never looked, from no one they know of, is a weak fit however similar the home.
  if (cs === 0 && ag === 0 && co === 0) score *= 0.4;
  return { score, why: why.slice(0, 2) };
}

/** The best fits, at most `limit`, with a little freshness so new listings get a chance. */
export function rankSuggestions(cs: Candidate[], t: Taste, now = new Date(), limit = 12, labels: { type?: (code: string) => string } = {}) {
  return cs.map((c) => {
    const s = scoreListing(c, t, labels);
    const days = c.publishedAt ? (now.getTime() - c.publishedAt.getTime()) / 864e5 : 60;
    return { id: c.id, score: s.score + (days < 7 ? 0.4 : days < 30 ? 0.15 : 0), why: s.why };
  }).filter((x) => x.score > 1 && x.why.length > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

/** The few things that most shape someone's suggestions, to show them on their privacy page. */
export function tasteSummary(t: Taste, typeLabel: (c: string) => string = (c) => c) {
  return {
    cities: top(t.cities).slice(0, 3).map(([k]) => k.replace(/\b\w/g, (x) => x.toUpperCase())),
    types: top(t.types).slice(0, 3).map(([k]) => typeLabel(k)),
    purposes: top(t.purposes).slice(0, 2).map(([k]) => k),
  };
}
