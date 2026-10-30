/**
 * Market insights: asking prices, rents, price per square metre, time on the market and yields, worked out from listings across
 * the platform, plus a company's rent forecast. Pure functions, tested on their own.
 *
 * Privacy: a figure is shown only when at least MIN_LISTINGS listings from at least MIN_COMPANIES different companies sit behind
 * it, so no figure can be traced to one company or one property. Company-to-platform comparisons need MIN_PEERS companies.
 */

export const MIN_LISTINGS = 5;
export const MIN_COMPANIES = 2;
export const MIN_PEERS = 5;

export type Sample = { companyId: string; purpose: "SALE" | "RENT" | "LEASE"; pricePeriod: string | null; priceKobo: bigint; bedrooms: number | null; propertyType: string; buildingSqm: number | null; city: string; state: string; publishedAt: Date | null; offMarketAt: Date | null };

/** Rent as a yearly figure. Nightly short lets are a different market and are left out of rent figures. */
export function yearlyKobo(s: { purpose: string; pricePeriod: string | null; priceKobo: bigint }): bigint | null {
  if (s.purpose === "SALE") return s.priceKobo;
  switch (s.pricePeriod) {
    case "NIGHT": return null;
    case "MONTH": return s.priceKobo * 12n;
    default: return s.priceKobo; // YEAR, or not stated (Nigerian rents are quoted yearly)
  }
}

export const SEGMENTS = { HOME: "Homes", LAND: "Land", COMMERCIAL: "Commercial" } as const;
export type Segment = keyof typeof SEGMENTS;
const LAND = new Set(["LAND"]);
const COMMERCIAL = new Set(["OFFICE", "SHOP", "PLAZA", "HOTEL", "EVENT_CENTRE", "WAREHOUSE", "INDUSTRIAL", "FILLING_STATION", "FARM", "PLANT_MACHINERY", "OTHER"]);
/** Rooms in shared homes are left out of home prices; they would drag the figures for whole homes down. */
const NOT_A_HOME = new Set(["ROOM", "SHARED_ROOM"]);
export const segmentOf = (propertyType: string): Segment | null => (LAND.has(propertyType) ? "LAND" : COMMERCIAL.has(propertyType) ? "COMMERCIAL" : NOT_A_HOME.has(propertyType) ? null : "HOME");

export const bedroomBand = (b: number | null) => (b === null || b <= 0 ? null : b >= 5 ? "5+" : String(b));

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export type Stat = { n: number; companies: number; median: number; low: number; high: number };

/** Median and the middle half (25th to 75th percentile) of some values, or null when too few listings or companies sit behind them. */
export function stat(values: { v: number; companyId: string }[]): Stat | null {
  const companies = new Set(values.map((x) => x.companyId)).size;
  if (values.length < MIN_LISTINGS || companies < MIN_COMPANIES) return null;
  const s = values.map((x) => x.v).sort((a, b) => a - b);
  return { n: s.length, companies, median: quantile(s, 0.5), low: quantile(s, 0.25), high: quantile(s, 0.75) };
}

const naira = (k: bigint) => Number(k) / 100;

export type CityInsight = {
  city: string; state: string; listings: number;
  sale: Stat | null; rent: Stat | null; salePerSqm: Stat | null;
  byBedrooms: { band: string; sale: Stat | null; rent: Stat | null; yieldPct: number | null }[];
  daysOnMarket: Stat | null;
};

/** Everything shown for one city: asking prices and yearly rents for homes, by bedrooms, per square metre, time on the market and yield. */
export function cityInsight(city: string, state: string, rows: Sample[], now: Date): CityInsight {
  const homes = rows.filter((r) => segmentOf(r.propertyType) === "HOME");
  const sale = homes.filter((r) => r.purpose === "SALE");
  const rent = homes.filter((r) => r.purpose === "RENT").map((r) => ({ r, y: yearlyKobo(r) })).filter((x) => x.y !== null) as { r: Sample; y: bigint }[];
  const bands = ["1", "2", "3", "4", "5+"];
  const byBedrooms = bands.map((band) => {
    const s = stat(sale.filter((r) => bedroomBand(r.bedrooms) === band).map((r) => ({ v: naira(r.priceKobo), companyId: r.companyId })));
    const t = stat(rent.filter((x) => bedroomBand(x.r.bedrooms) === band).map((x) => ({ v: naira(x.y), companyId: x.r.companyId })));
    return { band, sale: s, rent: t, yieldPct: grossYield(t, s) };
  }).filter((b) => b.sale || b.rent);
  const sqm = sale.filter((r) => r.buildingSqm && r.buildingSqm >= 20).map((r) => ({ v: naira(r.priceKobo) / r.buildingSqm!, companyId: r.companyId }));
  const dom = rows.filter((r) => r.publishedAt && r.offMarketAt && r.offMarketAt > r.publishedAt && now.getTime() - r.offMarketAt.getTime() < 365 * 864e5)
    .map((r) => ({ v: (r.offMarketAt!.getTime() - r.publishedAt!.getTime()) / 864e5, companyId: r.companyId }));
  return {
    city, state, listings: rows.length,
    sale: stat(sale.map((r) => ({ v: naira(r.priceKobo), companyId: r.companyId }))),
    rent: stat(rent.map((x) => ({ v: naira(x.y), companyId: x.r.companyId }))),
    salePerSqm: stat(sqm), byBedrooms, daysOnMarket: stat(dom),
  };
}

/** Gross yield: a year's median rent as a share of the median asking price for the same kind of home. An estimate. */
export function grossYield(rent: Stat | null, sale: Stat | null): number | null {
  if (!rent || !sale || sale.median <= 0) return null;
  const y = (rent.median / sale.median) * 100;
  return y > 0 && y < 40 ? Math.round(y * 10) / 10 : null;
}

/** Median asking price by month of publication, last 12 months, only for months with enough listings behind them. */
export function monthlyTrend(rows: Sample[], purpose: "SALE" | "RENT", now: Date): { month: string; median: number | null; n: number }[] {
  const months: string[] = [];
  for (let k = 11; k >= 0; k--) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1)); months.push(d.toISOString().slice(0, 7)); }
  return months.map((m) => {
    const vals = rows.filter((r) => r.purpose === purpose && segmentOf(r.propertyType) === "HOME" && r.publishedAt?.toISOString().slice(0, 7) === m)
      .map((r) => ({ y: yearlyKobo(r), c: r.companyId })).filter((x) => x.y !== null).map((x) => ({ v: naira(x.y!), companyId: x.c }));
    const st = stat(vals);
    return { month: m, median: st ? st.median : null, n: vals.length };
  });
}

/** Where a price sits against the middle half of the market: below, within or above it, and by how much against the median. */
export function position(value: number, s: Stat): { where: "below" | "within" | "above"; vsMedianPct: number } {
  const where = value < s.low ? "below" : value > s.high ? "above" : "within";
  return { where, vsMedianPct: Math.round(((value - s.median) / s.median) * 100) };
}

/** Short naira for figures: ₦2.5m, ₦850k, ₦1.2bn. */
export function compactNaira(n: number): string {
  const f = (v: number, u: string) => `₦${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10}${u}`;
  if (n >= 1e9) return f(n / 1e9, "bn");
  if (n >= 1e6) return f(n / 1e6, "m");
  if (n >= 1e3) return f(n / 1e3, "k");
  return `₦${Math.round(n)}`;
}

// ---------- A company's rent forecast ----------

export type ForecastCharge = { dueDate: Date; amountKobo: bigint; adjustedKobo: bigint; paidKobo: bigint };

/**
 * The next 12 months of rent: what is scheduled to fall due each month, and how much of it the company's own collection record
 * says will likely come in, plus the arrears already owed. Every figure comes from the company's records; the "likely" line applies its own collection rate.
 */
export function rentForecast(charges: ForecastCharge[], collectionRate: number | null, now: Date) {
  const months: { month: string; dueKobo: bigint; likelyKobo: bigint; atRiskKobo: bigint }[] = [];
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  for (let k = 0; k < 12; k++) months.push({ month: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + k, 1)).toISOString().slice(0, 7), dueKobo: 0n, likelyKobo: 0n, atRiskKobo: 0n });
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 12, 1);
  const rate = collectionRate === null ? 1 : Math.max(0, Math.min(1, collectionRate));
  let arrearsKobo = 0n;
  for (const c of charges) {
    const owed = c.amountKobo + c.adjustedKobo - c.paidKobo;
    if (owed <= 0n) continue;
    const t = c.dueDate.getTime();
    if (t < now.getTime()) { arrearsKobo += owed; continue; }
    if (t < start || t >= end) continue;
    const m = months.find((x) => x.month === c.dueDate.toISOString().slice(0, 7));
    if (!m) continue;
    m.dueKobo += owed;
    m.likelyKobo += BigInt(Math.round(Number(owed) * rate));
  }
  return { months, arrearsKobo, rate: collectionRate };
}

/** Rent at risk: for leases ending within the year without an agreed renewal, a year's rent from the end date to the horizon. */
export function rentAtRisk(leases: { endDate: Date; rentKobo: bigint; frequency: string; renewing: boolean }[], now: Date): { leases: number; yearlyKobo: bigint } {
  const horizon = now.getTime() + 365 * 864e5;
  const perYear: Record<string, bigint> = { MONTHLY: 12n, QUARTERLY: 4n, HALF_YEARLY: 2n, YEARLY: 1n };
  const ending = leases.filter((l) => !l.renewing && l.endDate.getTime() >= now.getTime() && l.endDate.getTime() <= horizon);
  return { leases: ending.length, yearlyKobo: ending.reduce((s, l) => s + l.rentKobo * (perYear[l.frequency] ?? 1n), 0n) };
}
