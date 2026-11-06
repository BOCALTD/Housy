import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIRM_EVERY_DAYS, bestMatch, comparableNaira, completeness, confirmationState, duplicateKey, freshness, groupDuplicates, priceVerdict, type MatchInput } from "../../src/lib/match-rules";

const now = new Date("2026-11-01T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 864e5);
let n = 0;
const L = (o: Partial<MatchInput> = {}): MatchInput => ({
  id: `l${++n}`, companyId: "c1", publicRef: `R${n}`, purpose: "RENT", pricePeriod: "YEAR", priceKobo: 300_000_000n, bedrooms: 2, propertyType: "FLAT",
  city: "Lekki", estateName: "", lat: null, lng: null, description: "", videoUrl: "", bathrooms: null, buildingSqm: null, landSqm: null,
  furnishing: "", availableFrom: null, publishedAt: daysAgo(10), photos: 0, ...o,
});

test("price verdicts need enough listings and use clear thresholds", () => {
  assert.equal(priceVerdict(2_700_000, { median: 3_000_000, n: 4 }), null, "too few to compare");
  assert.equal(priceVerdict(null, { median: 3_000_000, n: 20 }), null);
  assert.deepEqual(priceVerdict(2_700_000, { median: 3_000_000, n: 20 }), { kind: "good", pct: -10 });
  assert.equal(priceVerdict(2_800_000, { median: 3_000_000, n: 20 })!.kind, "fair");
  assert.equal(priceVerdict(3_750_000, { median: 3_000_000, n: 20 })!.kind, "high");
  assert.equal(priceVerdict(3_000_000, { median: 0, n: 20 }), null);
});

test("rents are compared as a year's rent", () => {
  assert.equal(comparableNaira({ purpose: "SALE", pricePeriod: "", priceKobo: 5_000_000_000n }), 50_000_000);
  assert.equal(comparableNaira({ purpose: "RENT", pricePeriod: "YEAR", priceKobo: 300_000_000n }), 3_000_000);
  const monthly = comparableNaira({ purpose: "RENT", pricePeriod: "MONTH", priceKobo: 25_000_000n });
  assert.equal(monthly, 3_000_000);
});

test("completeness and freshness are bounded", () => {
  assert.equal(completeness(L()).score <= 1, true);
  const full = completeness(L({ photos: 20, description: "x".repeat(400), videoUrl: "https://v", lat: 6.4, lng: 3.4, bathrooms: 2, buildingSqm: 90, furnishing: "FURNISHED", availableFrom: now }));
  assert.equal(full.score, 30);
  assert.deepEqual(full.reasons, ["20 photos", "Has a video"]);
  assert.ok(Math.abs(freshness(now, now) - 15) < 1e-9);
  assert.ok(Math.abs(freshness(daysAgo(21), now) - 7.5) < 1e-9);
  assert.equal(freshness(null, now), 0);
});

test("best match puts good value, complete and trusted listings first, and explains why", () => {
  const plain = L({ publishedAt: daysAgo(2) });
  const good = L({ priceKobo: 240_000_000n, photos: 8, companyId: "trusted" });
  const pricey = L({ priceKobo: 450_000_000n, photos: 8 });
  const out = bestMatch([plain, pricey, good], { now, areaPrice: () => ({ median: 3_000_000, n: 30 }), trustLevel: (id) => (id === "trusted" ? 3 : 0), areaName: (l) => l.city });
  assert.equal(out[0].id, good.id);
  assert.deepEqual(out[0].matchWhy, ["Good price for Lekki", "8 photos", "Verified company"]);
  assert.equal(out[0].verdict!.kind, "good");
  assert.equal(out.find((x) => x.id === pricey.id)!.verdict!.kind, "high");
  assert.ok(out.find((x) => x.id === plain.id)!.matchWhy.includes("New this week"));
  // The same input always gives the same order.
  const again = bestMatch([good, plain, pricey], { now, areaPrice: () => ({ median: 3_000_000, n: 30 }), trustLevel: (id) => (id === "trusted" ? 3 : 0), areaName: (l) => l.city });
  assert.deepEqual(again.map((x) => x.id), out.map((x) => x.id));
});

test("the same home listed twice is grouped; different homes are not", () => {
  const a = L({ lat: 6.4321, lng: 3.4567, companyId: "A" });
  const b = L({ lat: 6.4323, lng: 3.4569, companyId: "B", priceKobo: 310_000_000n });
  const otherBeds = L({ lat: 6.4321, lng: 3.4567, bedrooms: 3 });
  const otherPrice = L({ lat: 6.4321, lng: 3.4567, priceKobo: 450_000_000n });
  const noPlace = L();
  const estate1 = L({ estateName: "Chevy  View", city: "Lekki" });
  const estate2 = L({ estateName: "chevy view", city: "LEKKI", companyId: "Z" });
  assert.equal(duplicateKey(noPlace), null, "not enough to tell");
  assert.equal(duplicateKey(a), duplicateKey(b));
  assert.notEqual(duplicateKey(a), duplicateKey(otherBeds));
  assert.notEqual(duplicateKey(a), duplicateKey(otherPrice));
  assert.equal(duplicateKey(estate1), duplicateKey(estate2));
  const g = groupDuplicates([a, b, otherBeds, noPlace, L(), estate1, estate2]);
  assert.equal(g.length, 5);
  assert.deepEqual(g[0].alsoListed, [{ publicRef: b.publicRef, companyId: "B" }]);
  assert.equal(g.find((x) => x.id === estate1.id)!.alsoListed.length, 1);
});

test("listings must be confirmed every 45 days, with a reminder a week before", () => {
  assert.equal(confirmationState(null, null, now), null);
  assert.equal(confirmationState(null, daysAgo(10), now)!.state, "ok");
  assert.equal(confirmationState(null, daysAgo(40), now)!.state, "remind");
  assert.equal(confirmationState(null, daysAgo(CONFIRM_EVERY_DAYS), now)!.state, "expired");
  assert.equal(confirmationState(daysAgo(3), daysAgo(200), now)!.state, "ok", "a recent confirmation counts, not the publish date");
});
