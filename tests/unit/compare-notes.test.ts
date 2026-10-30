import { test } from "node:test";
import assert from "node:assert/strict";
import { compareNotes, type CompareRow } from "../../src/lib/compare-notes";
import type { CityInsight } from "../../src/lib/market-rules";

const row = (o: Partial<CompareRow>): CompareRow => ({
  ref: "P", name: "A", purpose: "RENT", pricePeriod: "YEAR", priceKobo: 500_000_000n, serviceChargeKobo: null, bedrooms: 2, buildingSqm: null, landSqm: null,
  city: "Lekki", propertyType: "FLAT", titleDocument: "UNSPECIFIED", furnishing: "UNFURNISHED", serviced: false, amenities: [], verifiedCompany: false, ...o,
});

test("yearly cost includes the service charge and names the cheapest", () => {
  const n = compareNotes([row({ name: "Flat A", priceKobo: 500_000_000n, serviceChargeKobo: 100_000_000n }), row({ name: "Flat B", priceKobo: 550_000_000n })]);
  assert.match(n[0], /^Flat B has the lowest yearly cost .* ₦5\.5m; Flat A is 9% more at ₦6m\.$/);
});

test("mixed purposes are not priced against each other", () => {
  const n = compareNotes([row({ name: "A", purpose: "SALE" }), row({ name: "B" })]);
  assert.match(n[0], /not all for the same purpose/);
  assert.ok(!n.some((x) => /lowest/.test(x)));
});

test("market position, title, verification and amenities", () => {
  const city = { city: "Lekki", state: "Lagos", listings: 20, sale: null, rent: null, salePerSqm: null, daysOnMarket: null,
    byBedrooms: [{ band: "3", sale: { n: 8, companies: 3, median: 100_000_000, low: 90_000_000, high: 110_000_000 }, rent: null, yieldPct: null }] } as CityInsight;
  const n = compareNotes([
    row({ name: "Duplex", purpose: "SALE", pricePeriod: "TOTAL", priceKobo: 13_000_000_000n, bedrooms: 3, titleDocument: "C_OF_O", verifiedCompany: true, amenities: ["POOL", "GENERATOR"] }),
    row({ name: "Terrace", purpose: "SALE", pricePeriod: "TOTAL", priceKobo: 9_500_000_000n, bedrooms: 4, amenities: ["GENERATOR"] }),
  ], [city], (c) => ({ POOL: "Pool", GENERATOR: "Generator" })[c] ?? c);
  assert.ok(n.some((x) => x === "Duplex is 30% above the typical asking price for 3-bedroom homes in Lekki."));
  assert.ok(n.some((x) => x === "Terrace has the most bedrooms (4)."));
  assert.ok(n.some((x) => /Terrace does not state a title document/.test(x)));
  assert.ok(n.some((x) => x === "Duplex is listed by a company whose business checks the platform has verified."));
  assert.ok(n.some((x) => x === "Only Duplex lists pool."));
});

test("one property alone has nothing to compare", () => assert.deepEqual(compareNotes([row({})]), []));
