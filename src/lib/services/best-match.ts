import type { Prisma } from "@prisma/client";
import { withPublic } from "../db";
import { bedroomBand, segmentOf } from "../market-rules";
import { CONFIRM_EVERY_DAYS, bestMatch, comparableNaira, groupDuplicates, priceVerdict, type AreaPrice, type MatchInput, type PriceVerdict } from "../match-rules";
import { marketOverview } from "./market";
import { trustMany } from "./kyc";

/** How many listings Best match looks at for one search (newest first). Narrower filters see all of theirs. */
export const BEST_POOL = 600;

/** Listings confirmed as still available within the last 45 days (or published within it, before the first confirmation). */
export function freshWhere(now = new Date()): Prisma.ListingWhereInput {
  const cutoff = new Date(now.getTime() - CONFIRM_EVERY_DAYS * 864e5);
  return { OR: [{ confirmedAt: { gte: cutoff } }, { confirmedAt: null, publishedAt: { gte: cutoff } }] };
}

const MATCH_SELECT = {
  id: true, companyId: true, publicRef: true, purpose: true, pricePeriod: true, priceKobo: true, currency: true, bedrooms: true, propertyType: true,
  city: true, state: true, estateName: true, lat: true, lng: true, description: true, videoUrl: true, bathrooms: true, buildingSqm: true,
  landSqm: true, furnishing: true, availableFrom: true, publishedAt: true, _count: { select: { photos: true } },
} as const;

type Pricer = (l: { purpose: string; propertyType: string; bedrooms: number | null; city: string }) => AreaPrice;

/** The typical price for a kind of home in a city, from the market pages (homes only; by bedrooms where there are enough). */
export async function areaPricer(waitMs = 400): Promise<Pricer> {
  // Market figures are rebuilt at most hourly; a search never waits for a rebuild (it uses them from the next search on).
  const m = await Promise.race([marketOverview().catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), waitMs))]);
  const byCity = new Map((m?.cities ?? []).map((c) => [c.city.trim().toLowerCase(), c]));
  return (l) => {
    if (l.purpose !== "SALE" && l.purpose !== "RENT") return null;
    if (segmentOf(l.propertyType) !== "HOME") return null;
    const c = byCity.get(l.city.trim().toLowerCase());
    if (!c) return null;
    const band = bedroomBand(l.bedrooms);
    const b = band ? c.byBedrooms.find((x) => x.band === band) : undefined;
    const s = (l.purpose === "SALE" ? b?.sale : b?.rent) ?? null;
    return s ? { median: s.median, n: s.n } : null;
  };
}

/** Price verdicts for listings already on screen (any sort order), for the "Good price" badge. */
export async function priceVerdicts(rows: { id: string; purpose: string; pricePeriod: string; priceKobo: bigint; propertyType: string; bedrooms: number | null; city: string }[]) {
  const price = await areaPricer();
  return new Map(rows.map((r) => [r.id, priceVerdict(comparableNaira(r), price(r))] as const));
}

export type MatchExtras = { matchWhy: string[]; verdict: PriceVerdict | null; alsoListed: { publicRef: string; companyId: string }[] };

/**
 * One page of results in Best match order. The newest listings that fit (up to BEST_POOL) are scored for value, completeness,
 * trust and freshness, and copies of the same property are grouped under the best one. Anything older than that pool follows
 * in newest-first order, so the total and every page stay right however many listings there are.
 */
export async function bestMatchPage(where: Prisma.ListingWhereInput, page: number, pageSize: number, now = new Date()) {
  const [pool, count] = await withPublic((tx) => Promise.all([
    tx.listing.findMany({ where, select: MATCH_SELECT, orderBy: [{ publishedAt: "desc" }, { publicRef: "asc" }], take: BEST_POOL }),
    tx.listing.count({ where }),
  ]));
  const [price, trust] = await Promise.all([areaPricer(), trustMany("COMPANY", [...new Set(pool.map((p) => p.companyId))])]);
  const input = pool.map(({ _count, ...p }) => ({ ...p, photos: _count.photos })) as (MatchInput & { state: string })[];
  const scored = bestMatch(input, { now, areaPrice: price, trustLevel: (id) => trust.get(id)?.level ?? 0, areaName: (l) => l.city });
  const grouped = groupDuplicates(scored);
  const total = count - (pool.length - grouped.length);
  const start = (page - 1) * pageSize;
  const fromPool = grouped.slice(start, start + pageSize);
  const restNeeded = pageSize - fromPool.length;
  const restSkip = pool.length + Math.max(0, start - grouped.length);
  const [full, rest] = await withPublic((tx) => Promise.all([
    tx.listing.findMany({ where: { id: { in: fromPool.map((s) => s.id) } } }),
    restNeeded > 0 && count > pool.length ? tx.listing.findMany({ where, orderBy: [{ publishedAt: "desc" }, { publicRef: "asc" }], skip: restSkip, take: restNeeded }) : Promise.resolve([]),
  ]));
  const byId = new Map(full.map((r) => [r.id, r]));
  const none: MatchExtras = { matchWhy: [], verdict: null, alsoListed: [] };
  const rows = [
    ...fromPool.map((s) => byId.get(s.id) ? { ...byId.get(s.id)!, matchWhy: s.matchWhy, verdict: s.verdict, alsoListed: s.alsoListed } : null).filter((x): x is NonNullable<typeof x> => !!x),
    ...rest.map((r) => ({ ...r, ...none })),
  ];
  return { total, pages: Math.max(1, Math.ceil(total / pageSize)), rows };
}
