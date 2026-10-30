import { test } from "node:test";
import assert from "node:assert/strict";
import { cityInsight, compactNaira, grossYield, monthlyTrend, position, rentAtRisk, rentForecast, segmentOf, stat, yearlyKobo, type Sample } from "../../src/lib/market-rules";

const N = (n: number) => BigInt(Math.round(n * 100));
const now = new Date("2026-10-30T09:00:00Z");
function sample(o: Partial<Sample> & { companyId: string; price: number }): Sample {
  return { purpose: "SALE", pricePeriod: "TOTAL", priceKobo: N(o.price), bedrooms: 3, propertyType: "HOUSE", buildingSqm: null, city: "Lekki", state: "Lagos", publishedAt: new Date("2026-09-10"), offMarketAt: null, ...o } as Sample;
}

test("rents become yearly, short lets and rooms are kept out of home figures", () => {
  assert.equal(yearlyKobo({ purpose: "RENT", pricePeriod: "MONTH", priceKobo: N(100_000) }), N(1_200_000));
  assert.equal(yearlyKobo({ purpose: "RENT", pricePeriod: "NIGHT", priceKobo: N(50_000) }), null);
  assert.equal(yearlyKobo({ purpose: "RENT", pricePeriod: "YEAR", priceKobo: N(3_000_000) }), N(3_000_000));
  assert.equal(segmentOf("FLAT"), "HOME"); assert.equal(segmentOf("WAREHOUSE"), "COMMERCIAL"); assert.equal(segmentOf("LAND"), "LAND"); assert.equal(segmentOf("ROOM"), null);
});

test("no figure is shown unless enough listings from enough companies sit behind it", () => {
  const four = [1, 2, 3, 4].map((v, i) => ({ v, companyId: `c${i % 2}` }));
  assert.equal(stat(four), null, "four listings are too few");
  assert.equal(stat([1, 2, 3, 4, 5].map((v) => ({ v, companyId: "only-one" }))), null, "one company alone is never shown");
  const s = stat([10, 20, 30, 40, 50].map((v, i) => ({ v, companyId: `c${i % 2}` })))!;
  assert.deepEqual([s.n, s.companies, s.median, s.low, s.high], [5, 2, 30, 20, 40]);
  assert.deepEqual(position(55, s), { where: "above", vsMedianPct: 83 });
  assert.deepEqual(position(25, s), { where: "within", vsMedianPct: -17 });
});

test("a city's insight: prices by bedrooms, per square metre, yields and time on the market", () => {
  const rows: Sample[] = [];
  for (let i = 0; i < 6; i++) rows.push(sample({ companyId: `c${i % 3}`, price: 100_000_000 + i * 10_000_000, buildingSqm: 250 }));
  for (let i = 0; i < 6; i++) rows.push(sample({ companyId: `c${i % 3}`, price: 5_000_000 + i * 500_000, purpose: "RENT", pricePeriod: "YEAR", publishedAt: new Date("2026-03-01"), offMarketAt: new Date(new Date("2026-03-01").getTime() + (20 + i) * 864e5) }));
  rows.push(sample({ companyId: "c9", price: 120_000, purpose: "RENT", pricePeriod: "NIGHT" }));
  const c = cityInsight("Lekki", "Lagos", rows, now);
  assert.equal(c.sale!.median, 125_000_000);
  assert.equal(c.rent!.median, 6_250_000, "the nightly short let is not counted as rent");
  assert.equal(c.salePerSqm!.median, 500_000);
  const three = c.byBedrooms.find((b) => b.band === "3")!;
  assert.equal(three.yieldPct, 5);
  assert.equal(c.daysOnMarket!.median, 22.5);
  assert.equal(grossYield(null, c.sale), null);
  const trend = monthlyTrend(rows, "SALE", now);
  assert.equal(trend.length, 12); assert.equal(trend[11].month, "2026-10");
  assert.equal(trend.find((t) => t.month === "2026-09")!.median, 125_000_000);
  assert.equal(compactNaira(125_000_000), "₦125m"); assert.equal(compactNaira(2_500_000), "₦2.5m"); assert.equal(compactNaira(1_200_000_000), "₦1.2bn");
});

test("the rent forecast spreads what is due over the next 12 months and applies the company's own collection rate", () => {
  const f = rentForecast([
    { dueDate: new Date("2026-09-01"), amountKobo: N(500_000), adjustedKobo: 0n, paidKobo: N(200_000) },
    { dueDate: new Date("2026-11-01"), amountKobo: N(1_000_000), adjustedKobo: 0n, paidKobo: 0n },
    { dueDate: new Date("2027-01-01"), amountKobo: N(1_000_000), adjustedKobo: N(50_000), paidKobo: 0n },
    { dueDate: new Date("2027-12-01"), amountKobo: N(1_000_000), adjustedKobo: 0n, paidKobo: 0n },
  ], 0.9, now);
  assert.equal(f.arrearsKobo, N(300_000));
  assert.equal(f.months[0].month, "2026-10");
  assert.equal(f.months[1].dueKobo, N(1_000_000)); assert.equal(f.months[1].likelyKobo, N(900_000));
  assert.equal(f.months[3].dueKobo, N(1_050_000));
  assert.equal(f.months.reduce((s, m) => s + m.dueKobo, 0n), N(2_050_000), "beyond 12 months is left out");
  const risk = rentAtRisk([
    { endDate: new Date("2027-02-01"), rentKobo: N(100_000), frequency: "MONTHLY", renewing: false },
    { endDate: new Date("2027-03-01"), rentKobo: N(3_000_000), frequency: "YEARLY", renewing: true },
    { endDate: new Date("2028-03-01"), rentKobo: N(3_000_000), frequency: "YEARLY", renewing: false },
  ], now);
  assert.deepEqual(risk, { leases: 1, yearlyKobo: N(1_200_000) });
});
