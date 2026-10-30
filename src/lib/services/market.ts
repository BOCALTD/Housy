/**
 * Market insights from listings across the platform, and a company's benchmarks and rent forecast.
 * Only totals leave this file: every market figure needs MIN_LISTINGS listings from MIN_COMPANIES companies (market-rules),
 * listings never published are not counted, and no listing, company or person can be picked out of the results.
 */
import { withPlatformAdmin, withTenant } from "../db";
import { can } from "../permissions";
import { todayInLagos } from "../dates";
import type { Ctx } from "./context";
import {
  MIN_PEERS, bedroomBand, cityInsight, monthlyTrend, position, quantile, rentAtRisk, rentForecast, segmentOf, stat, yearlyKobo,
  type CityInsight, type Sample,
} from "../market-rules";

/** Published listings, and those taken off the market in the last year, as market samples. Run as the platform, totals only. */
async function samples(where: { city?: string } = {}): Promise<Sample[]> {
  const since = new Date(Date.now() - 365 * 864e5);
  return withPlatformAdmin("system", (tx) => tx.listing.findMany({
    where: {
      publishedAt: { not: null }, country: "NG", platformHidden: false, ...(where.city ? { city: { equals: where.city, mode: "insensitive" as const } } : {}),
      OR: [{ status: "PUBLISHED" }, { status: "UNAVAILABLE", offMarketAt: { gte: since } }],
    },
    select: { companyId: true, purpose: true, pricePeriod: true, priceKobo: true, bedrooms: true, propertyType: true, buildingSqm: true, city: true, state: true, publishedAt: true, offMarketAt: true },
    take: 50_000,
  })) as Promise<Sample[]>;
}

export type MarketOverview = { generatedAt: Date; cities: (CityInsight & { slug: string })[]; trendSale: ReturnType<typeof monthlyTrend>; trendRent: ReturnType<typeof monthlyTrend>; listings: number };

export const citySlug = (city: string) => city.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function buildOverview(): Promise<MarketOverview> {
  const now = new Date();
  const rows = await samples();
  const byCity = new Map<string, Sample[]>();
  for (const r of rows) { const k = `${r.city.trim()}|${r.state.trim()}`; const a = byCity.get(k); if (a) a.push(r); else byCity.set(k, [r]); }
  const cities = [...byCity].map(([k, rs]) => { const [city, state] = k.split("|"); return { ...cityInsight(city, state, rs, now), slug: citySlug(city) }; })
    .filter((c) => c.sale || c.rent).sort((a, b) => b.listings - a.listings);
  return { generatedAt: now, cities, trendSale: monthlyTrend(rows, "SALE", now), trendRent: monthlyTrend(rows, "RENT", now), listings: rows.length };
}

/** The national picture, recalculated at most once an hour per server (a failed build is not kept). */
const TTL_MS = 3600_000;
let cached: { at: number; value: Promise<MarketOverview> } | null = null;
export function marketOverview(): Promise<MarketOverview> {
  if (!cached || Date.now() - cached.at > TTL_MS) {
    const value = buildOverview();
    cached = { at: Date.now(), value };
    value.catch(() => { if (cached?.value === value) cached = null; });
  }
  return cached.value;
}
/** For tests and after bulk imports: the next request recalculates. */
export const forgetMarketOverview = () => { cached = null; };

export async function marketCity(slug: string) {
  const o = await marketOverview();
  const c = o.cities.find((x) => x.slug === slug);
  if (!c) return null;
  const now = new Date();
  const rows = await samples({ city: c.city });
  return { ...c, trendSale: monthlyTrend(rows, "SALE", now), trendRent: monthlyTrend(rows, "RENT", now) };
}

// ---------- A company's benchmarks ----------

/**
 * How a company compares: each of its published home listings against the middle of the market in its city for the same number
 * of bedrooms; its time on the market against the city's; and its occupancy and rent collection against other companies on the
 * platform (only when at least MIN_PEERS companies have enough records to compare, and never naming them).
 */
export async function companyBenchmarks(ctx: Ctx, now = new Date()) {
  if (!can(ctx.role, "asset.view")) return null;
  const o = await marketOverview();
  const mine = await withTenant(ctx.companyId, ctx.userId, (tx) => tx.listing.findMany({
    where: { companyId: ctx.companyId, status: "PUBLISHED" }, select: { publicRef: true, title: true, purpose: true, pricePeriod: true, priceKobo: true, bedrooms: true, propertyType: true, city: true }, take: 500,
  }));
  const listings = mine.flatMap((l) => {
    if (segmentOf(l.propertyType) !== "HOME") return [];
    const c = o.cities.find((x) => x.city.toLowerCase() === l.city.trim().toLowerCase());
    const band = c?.byBedrooms.find((b) => b.band === bedroomBand(l.bedrooms));
    const s = l.purpose === "SALE" ? band?.sale : l.purpose === "RENT" ? band?.rent : null;
    const y = yearlyKobo(l);
    if (!s || y === null) return [];
    return [{ ref: l.publicRef, title: l.title, city: l.city, band: band!.band, purpose: l.purpose, value: Number(y) / 100, market: s, ...position(Number(y) / 100, s) }];
  });

  // Peers: occupancy and collection for every company with enough records, as anonymous numbers only.
  const since = new Date(now.getTime() - 365 * 864e5);
  const peers = await withPlatformAdmin("system", async (tx) => {
    const occ = await tx.$queryRaw<{ company_id: string; occupied: bigint; leasable: bigint }[]>`
      SELECT company_id, count(*) FILTER (WHERE status = 'OCCUPIED')::bigint AS occupied, count(*) FILTER (WHERE status IN ('OCCUPIED', 'VACANT'))::bigint AS leasable
      FROM assets GROUP BY company_id HAVING count(*) FILTER (WHERE status IN ('OCCUPIED', 'VACANT')) >= 5`;
    const col = await tx.$queryRaw<{ company_id: string; billed: bigint; paid: bigint }[]>`
      SELECT company_id, sum(amount_kobo + adjusted_kobo)::bigint AS billed, sum(LEAST(paid_kobo, amount_kobo + adjusted_kobo))::bigint AS paid
      FROM rent_charges WHERE due_date >= ${since}::date AND due_date < ${todayInLagos(now)}::date
      GROUP BY company_id HAVING count(*) >= 10 AND sum(amount_kobo + adjusted_kobo) > 0`;
    return { occ, col };
  });
  const occRates = peers.occ.map((p) => ({ id: p.company_id, v: Number(p.occupied) / Number(p.leasable) }));
  const colRates = peers.col.map((p) => ({ id: p.company_id, v: Number(p.paid) / Number(p.billed) }));
  const compare = (rates: { id: string; v: number }[]) => {
    const me = rates.find((r) => r.id === ctx.companyId)?.v ?? null;
    if (rates.length < MIN_PEERS || me === null) return { me, median: null as number | null, peers: rates.length };
    const s = rates.map((r) => r.v).sort((a, b) => a - b);
    return { me, median: quantile(s, 0.5), peers: rates.length };
  };
  return { generatedAt: o.generatedAt, listings, occupancy: compare(occRates), collection: compare(colRates) };
}

/** The next 12 months of rent for a company, from its own schedules and collection record, and the rent on leases ending unrenewed. */
export async function companyForecast(ctx: Ctx, now = new Date()) {
  if (!can(ctx.role, "payment.record")) return null;
  const today = todayInLagos(now);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const horizon = new Date(today.getTime() + 370 * 864e5);
    const [charges, past, leases, renewals] = await Promise.all([
      tx.rentCharge.findMany({ where: { companyId: ctx.companyId, dueDate: { lt: horizon }, lease: { status: "ACTIVE" } }, select: { dueDate: true, amountKobo: true, adjustedKobo: true, paidKobo: true }, take: 50_000 }),
      tx.rentCharge.aggregate({ where: { companyId: ctx.companyId, dueDate: { gte: new Date(today.getTime() - 365 * 864e5), lt: new Date(today.getTime() - 30 * 864e5) } }, _sum: { amountKobo: true, adjustedKobo: true, paidKobo: true }, _count: { _all: true } }),
      tx.lease.findMany({ where: { companyId: ctx.companyId, status: "ACTIVE" }, select: { id: true, endDate: true, rentKobo: true, frequency: true }, take: 20_000 }),
      tx.leaseRenewal.findMany({ where: { companyId: ctx.companyId, status: { in: ["PENDING", "APPROVED"] } }, select: { leaseId: true } }),
    ]);
    const billed = (past._sum.amountKobo ?? 0n) + (past._sum.adjustedKobo ?? 0n);
    // The collection rate counts only charges at least a month old, so recent ones still inside their grace period do not drag it down.
    const rate = past._count._all >= 6 && billed > 0n ? Math.min(1, Number(past._sum.paidKobo ?? 0n) / Number(billed)) : null;
    const renewing = new Set(renewals.map((r) => r.leaseId));
    return {
      ...rentForecast(charges, rate, today),
      atRisk: rentAtRisk(leases.map((l) => ({ endDate: l.endDate, rentKobo: l.rentKobo, frequency: l.frequency, renewing: renewing.has(l.id) })), today),
    };
  });
}

export { stat };
