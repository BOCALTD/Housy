import { test } from "node:test";
import assert from "node:assert/strict";
import { discountPct, effectiveTier, promoFee, promoLive, promoPriceProblem, promoStaleReason, ratingDue, rankListings, tierPerks } from "../../src/lib/tier-rules";

const now = new Date("2026-11-27T10:00:00Z");

test("perks follow the tier: only Gold gets the badge, the tag and the boost; Silver and Gold promote for free", () => {
  assert.deepEqual([tierPerks("BASIC").freePromos, tierPerks("SILVER").freePromos, tierPerks("GOLD").freePromos], [false, true, true]);
  assert.deepEqual([tierPerks("SILVER").goldBadge, tierPerks("SILVER").premiumTag, tierPerks("SILVER").autoBoost], [false, false, false]);
  assert.deepEqual([tierPerks("GOLD").goldBadge, tierPerks("GOLD").premiumTag, tierPerks("GOLD").autoBoost], [true, true, true]);
});

test("a tier lasts only as long as the subscription period; without one a company is Basic", () => {
  assert.equal(effectiveTier(null, now), "BASIC");
  assert.equal(effectiveTier({ tier: "GOLD", validUntil: new Date("2026-12-01") }, now), "GOLD");
  assert.equal(effectiveTier({ tier: "GOLD", validUntil: new Date("2026-11-01") }, now), "BASIC");
});

test("Basic pays per property, Silver and Gold pay nothing", () => {
  assert.equal(promoFee("BASIC", 500000n, 3), 1500000n);
  assert.equal(promoFee("SILVER", 500000n, 3), 0n);
  assert.equal(promoFee("GOLD", 500000n, 3), 0n);
  assert.equal(promoFee("BASIC", 500000n, 0), 0n);
});

test("the promotional price must be a real cut off the real price", () => {
  const orig = 500_000_000n;
  assert.equal(discountPct(orig, 420_000_000n), 16);
  assert.equal(promoPriceProblem(orig, 420_000_000n, 60), null);
  assert.match(promoPriceProblem(orig, orig, 60)!, /lower/);
  assert.match(promoPriceProblem(orig, orig + 1n, 60)!, /lower/);
  assert.match(promoPriceProblem(orig, 0n, 60)!, /Enter/);
  assert.match(promoPriceProblem(orig, 100_000_000n, 60)!, /at most 60%/);
});

test("a promotion shows only while approved, in its dates, published and priced as approved", () => {
  const base = { entryStatus: "APPROVED" as const, campaign: { active: true, startsOn: new Date("2026-11-20"), endsOn: new Date("2026-11-30") }, listingStatus: "PUBLISHED", listingPriceKobo: 100n, originalPriceKobo: 100n, now };
  assert.equal(promoLive(base), true);
  assert.equal(promoLive({ ...base, now: new Date("2026-11-30T20:00:00Z") }), true, "the last day counts in full");
  assert.equal(promoLive({ ...base, now: new Date("2026-12-01T01:00:00Z") }), false);
  assert.equal(promoLive({ ...base, now: new Date("2026-11-19") }), false);
  assert.equal(promoLive({ ...base, entryStatus: "REQUESTED" }), false);
  assert.equal(promoLive({ ...base, listingStatus: "UNAVAILABLE" }), false);
  assert.equal(promoLive({ ...base, listingPriceKobo: 90n }), false, "the price was edited after approval");
  assert.equal(promoLive({ ...base, campaign: { ...base.campaign, active: false } }), false);
  assert.match(promoStaleReason({ ...base, listingPriceKobo: 90n })!, /price changed/);
  assert.equal(promoStaleReason(base), null);
});

test("Gold listings take one of every three places and take turns from day to day; nobody else is reordered", () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ id: `l${i}`, gold: i >= 8 }));
  const day1 = rankListings(items, (x) => x.gold, "2026-11-27");
  assert.deepEqual(day1.map((x) => x.gold).slice(0, 6), [true, false, false, true, false, false]);
  assert.deepEqual(day1.filter((x) => !x.gold).map((x) => x.id), ["l0", "l1", "l2", "l3", "l4", "l5", "l6", "l7"], "ordinary listings keep their order");
  assert.equal(day1.length, 12);
  const day2 = rankListings(items, (x) => x.gold, "2026-11-28");
  assert.notDeepEqual(day1.map((x) => x.id), day2.map((x) => x.id));
  assert.deepEqual(rankListings(items.slice(0, 8), (x) => x.gold, "d").map((x) => x.id), items.slice(0, 8).map((x) => x.id));
  assert.equal(rankListings(items.slice(8), (x) => x.gold, "d").length, 4, "only Gold: all are kept");
});

test("the rating prompt returns after the interval, and a reminder-later pauses it", () => {
  const joined = new Date("2026-09-01");
  const o = { accountCreatedAt: joined, lastRatedAt: null, snoozedUntil: null, intervalDays: 30, now };
  assert.equal(ratingDue(o), true);
  assert.equal(ratingDue({ ...o, accountCreatedAt: new Date("2026-11-20") }), false, "a new account is not asked yet");
  assert.equal(ratingDue({ ...o, lastRatedAt: new Date("2026-11-10") }), false);
  assert.equal(ratingDue({ ...o, lastRatedAt: new Date("2026-10-01") }), true);
  assert.equal(ratingDue({ ...o, snoozedUntil: new Date("2026-11-30") }), false);
  assert.equal(ratingDue({ ...o, snoozedUntil: new Date("2026-11-01") }), true);
  assert.equal(ratingDue({ ...o, intervalDays: 90, lastRatedAt: new Date("2026-10-01") }), false, "the administrator can lengthen it");
});
