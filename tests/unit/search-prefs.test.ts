import { test } from "node:test";
import assert from "node:assert/strict";
import { prefLabel, prefParams } from "../../src/lib/search-pref-rules";

test("my search reads as a short line and becomes search parameters", () => {
  const p = { city: "Lekki", purpose: "RENT" as const, maxNaira: 3_000_000, minBeds: 2 };
  assert.equal(prefLabel(p), "Lekki · Rent · up to ₦3m · 2+ bedrooms");
  assert.deepEqual(prefParams(p), { city: "Lekki", purpose: "RENT", maxPrice: "3000000", minBeds: "2" });
  assert.equal(prefLabel({ city: "", purpose: "SALE", maxNaira: 150_000_000, minBeds: null }), "Buy · up to ₦150m");
  assert.equal(prefLabel({ city: "", purpose: "", maxNaira: 2_500_000_000, minBeds: null }), "up to ₦2.5bn");
  assert.deepEqual(prefParams({ city: "", purpose: "", maxNaira: null, minBeds: 0 }), { minBeds: "0" });
});
