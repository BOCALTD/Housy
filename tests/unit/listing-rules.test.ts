import { test } from "node:test";
import assert from "node:assert/strict";
import { CATEGORIES, categoryBySlug, defaultPeriod, extraFilterCount, filtersToQuery, joinAmenities, keyFacts, parseAmenities, parseFilters, priceSuffix } from "../../src/lib/listing-rules";

const q = (s: string) => { const p = new URLSearchParams(s); return parseFilters((k) => p.get(k) ?? undefined, (k) => p.getAll(k)); };

test("filters are read forgivingly: unknown values are dropped, numbers bounded", () => {
  const f = q("purpose=RENT&type=FLAT,LAND,NOPE&type=DUPLEX&amenity=POOL&amenity=HACK&minBeds=3&minBaths=x&sort=price_asc&page=0&verified=1&availableBy=2026-12-01&furnishing=FURNISHED");
  assert.equal(f.purpose, "RENT");
  assert.deepEqual(f.types, ["FLAT", "LAND", "DUPLEX"]);
  assert.deepEqual(f.amenities, ["POOL"]);
  assert.equal(f.minBeds, 3);
  assert.equal(f.minBaths, undefined);
  assert.equal(f.sort, "price_asc");
  assert.equal(f.page, 1);
  assert.equal(f.verifiedOnly, true);
  assert.equal(f.availableBy, "2026-12-01");
  assert.equal(f.furnishing, "FURNISHED");
  const bad = q("purpose=DROP TABLE&sort=evil&availableBy=tomorrow&minSize=-5&furnishing=UNSPECIFIED");
  assert.equal(bad.purpose, undefined);
  assert.equal(bad.sort, "newest");
  assert.equal(bad.availableBy, undefined);
  assert.equal(bad.minSize, undefined);
  assert.equal(bad.furnishing, undefined);
});

test("filters round-trip through the address, and changes apply", () => {
  const f = q("city=Lekki&type=FLAT&amenity=POOL,GYM&minBeds=2&page=3");
  const s = filtersToQuery(f);
  assert.deepEqual(q(s), f);
  assert.equal(new URLSearchParams(filtersToQuery(f, { page: undefined })).get("page"), null);
  assert.equal(new URLSearchParams(filtersToQuery(f, { sort: "price_desc" })).get("sort"), "price_desc");
  assert.equal(extraFilterCount(f), 2);
});

test("categories have unique slugs and the right rules", () => {
  assert.equal(new Set(CATEGORIES.map((c) => c.slug)).size, CATEGORIES.length);
  assert.deepEqual(categoryBySlug("short-let")?.rule.period, ["NIGHT"]);
  assert.equal(categoryBySlug("nope"), null);
});

test("price periods, amenities and key facts", () => {
  assert.equal(priceSuffix("TOTAL"), "");
  assert.equal(priceSuffix("NIGHT"), " / night");
  assert.equal(defaultPeriod("SALE"), "TOTAL");
  assert.equal(defaultPeriod("LEASE"), "YEAR");
  assert.equal(joinAmenities(["POOL", "GYM", "POOL", "x"]), "GYM,POOL");
  assert.deepEqual(parseAmenities("GYM,POOL,bad"), ["GYM", "POOL"]);
  assert.deepEqual(keyFacts({ propertyType: "DUPLEX", bedrooms: 4, bathrooms: 5, toilets: 6, buildingSqm: 450, landSqm: 600, furnishing: "UNSPECIFIED" }), ["Duplex", "4 bed", "5 bath", "6 toilets", "450 m²"]);
  assert.deepEqual(keyFacts({ propertyType: "LAND", bedrooms: null, bathrooms: null, toilets: null, buildingSqm: null, landSqm: 1000, furnishing: "UNSPECIFIED" }), ["Land", "1,000 m² land"]);
});
