import { test } from "node:test";
import assert from "node:assert/strict";
import { rankSuggestions, scoreListing, tasteOf, tasteSummary, type Candidate, type Signal } from "../../src/lib/suggest-rules";

const now = new Date("2026-10-30T10:00:00Z");
const ago = (d: number) => new Date(now.getTime() - d * 864e5);
const sig = (o: Partial<Signal>): Signal => ({ kind: "PROPERTY_VIEW", city: "Lekki", propertyType: "FLAT", purpose: "RENT", priceKobo: 600_000_000n, bedrooms: 3, agentId: null, companyId: null, listingId: null, createdAt: ago(2), ...o });
const cand = (o: Partial<Candidate>): Candidate => ({ id: "x", city: "Lekki", propertyType: "FLAT", purpose: "RENT", pricePeriod: "YEAR", priceKobo: 600_000_000n, bedrooms: 3, postedById: null, companyId: "c1", publishedAt: ago(3), ...o });

test("taste comes from what someone does, recent and strong actions counting more", () => {
  const t = tasteOf([sig({}), sig({ kind: "ENQUIRY", city: "Ikeja", listingId: "L1" }), sig({ city: "Ajah", createdAt: ago(200) })], now);
  assert.ok(t.cities.get("ikeja")! > t.cities.get("lekki")!, "an enquiry outweighs a view");
  assert.ok(!t.cities.has("ajah"), "older than 180 days is forgotten");
  assert.ok(t.asked.has("L1"));
  assert.equal(t.price.get("RENT"), 600_000_000);
});

test("a close match is suggested with its reasons; a poor one is not", () => {
  const t = tasteOf([sig({}), sig({}), sig({ kind: "PROPERTY_SAVE" })], now);
  const good = scoreListing(cand({}), t);
  assert.ok(good.score > 3);
  assert.deepEqual(good.why, ["In Lekki, where you have been looking", "A flat, like others you looked at"]);
  const sale = scoreListing(cand({ purpose: "SALE", priceKobo: 20_000_000_000n, city: "Abuja", propertyType: "LAND", bedrooms: null }), t);
  assert.ok(sale.score < 1);
  const ranked = rankSuggestions([cand({ id: "a" }), cand({ id: "b", city: "Kano", purpose: "SALE" }), cand({ id: "c", priceKobo: 640_000_000n })], t, now);
  assert.deepEqual(ranked.map((r) => r.id).sort(), ["a", "c"]);
});

test("a property already asked about is not suggested again, and the summary names the main interests", () => {
  const t = tasteOf([sig({ kind: "ENQUIRY", listingId: "a" }), sig({})], now);
  assert.deepEqual(rankSuggestions([cand({ id: "a" })], t, now), []);
  assert.deepEqual(tasteSummary(t).cities, ["Lekki"]);
  assert.deepEqual(rankSuggestions([cand({})], tasteOf([], now), now), [], "nothing done yet, nothing suggested");
});
