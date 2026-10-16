import { test } from "node:test";
import assert from "node:assert/strict";
import { areaKeys, matchSearch, pickRecipients } from "../../src/lib/alert-rules";

const l = { purpose: "RENT", city: "Lekki", state: "Lagos", title: "Bright 2 bed flat", priceKobo: 300_000_000n, bedrooms: 2 };
const s = (o: Partial<Parameters<typeof matchSearch>[1]> = {}) => ({ purpose: "", city: "", q: "", maxKobo: null, minBeds: null, ...o });

test("a search matches only when every filter it sets is met", () => {
  assert.ok(matchSearch(l, s({ purpose: "RENT", city: "lekki" })));
  assert.ok(matchSearch(l, s({ city: "Lagos", maxKobo: 500_000_000n, minBeds: 2 })));
  assert.ok(!matchSearch(l, s({ purpose: "SALE" })));
  assert.ok(!matchSearch(l, s({ city: "Abuja" })));
  assert.ok(!matchSearch(l, s({ maxKobo: 100_000_000n })));
  assert.ok(!matchSearch(l, s({ minBeds: 3 })));
  assert.ok(!matchSearch({ ...l, bedrooms: null }, s({ minBeds: 1 })));
  assert.ok(matchSearch(l, s({ q: "FLAT" })));
});

test("an empty search never means everything", () => {
  assert.equal(matchSearch(l, s()), false);
  assert.equal(matchSearch(l, s({ city: "  " })), false);
});

test("areas are compared in lowercase against city and state", () => {
  assert.deepEqual(areaKeys({ city: " Lekki ", state: "Lagos" }), ["lekki", "lagos"]);
});

test("recipients: first reason wins, excluded people are left out, and the limit holds", () => {
  const r = pickRecipients([
    { reason: "SAVED_SEARCH", label: "your saved search", userIds: ["a", "b"] },
    { reason: "FOLLOW", label: "you follow them", userIds: ["b", "c", "owner"] },
    { reason: "AREA", label: "an area you chose", userIds: ["d", "e", "f"] },
  ], new Set(["owner"]), 4);
  assert.deepEqual([...r.keys()], ["a", "b", "c", "d"]);
  assert.equal(r.get("b")!.reason, "SAVED_SEARCH");
  assert.equal(r.size, 4);
});
