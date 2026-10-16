import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REWARD_STATUSES, REWARD_TRANSITIONS, addDays, attributionOpen, campaignOpen, isCodeShape, maskName, monthBounds, monthKey, normaliseEmail, payableAt, qualifyingOpen,
  referralSignals, rewardExplainer, rewardMoveProblem,
} from "../../src/lib/reward-rules";

test("a reward moves only forward along the allowed route, and a paid reward never moves", () => {
  assert.equal(rewardMoveProblem("ELIGIBLE", "APPROVED"), null);
  assert.equal(rewardMoveProblem("APPROVED", "PAYABLE"), null);
  assert.equal(rewardMoveProblem("PAYABLE", "PAID"), null);
  assert.match(rewardMoveProblem("ELIGIBLE", "PAID")!, /cannot become paid/);
  assert.match(rewardMoveProblem("APPROVED", "PAID")!, /cannot become paid/, "payment needs the payable step and a verified payout");
  assert.match(rewardMoveProblem("PAID", "CANCELLED")!, /paid reward cannot be changed/);
  assert.deepEqual(REWARD_TRANSITIONS.PAID, []);
  assert.equal(rewardMoveProblem("REJECTED", "DISPUTED"), null, "a rejected reward can be disputed");
  assert.equal(rewardMoveProblem("DISPUTED", "ELIGIBLE"), null);
  assert.match(rewardMoveProblem("REJECTED", "APPROVED")!, /./, "a rejection is not simply reversed");
  for (const s of REWARD_STATUSES) assert.ok(rewardExplainer(s, { reason: "A proper reason" }).length > 5);
});

test("months and hold periods follow Lagos time", () => {
  assert.equal(monthKey(new Date("2026-10-31T23:30:00Z")), "2026-11", "23:30 UTC is already November in Lagos");
  assert.equal(monthKey(new Date("2026-10-31T22:30:00Z")), "2026-10");
  const { start, end } = monthBounds("2026-10");
  assert.equal(start.toISOString(), "2026-09-30T23:00:00.000Z");
  assert.equal(end.toISOString(), "2026-10-31T23:00:00.000Z");
  assert.equal(payableAt(new Date("2026-10-01T00:00:00Z"), 14).toISOString(), "2026-10-15T00:00:00.000Z");
});

test("campaigns and attribution windows open and close on their dates", () => {
  const c = { startsOn: new Date("2026-10-01T00:00:00Z"), endsOn: new Date("2026-10-31T00:00:00Z"), active: true };
  const at = (s: string) => new Date(s);
  assert.equal(campaignOpen(c, at("2026-09-30T12:00:00Z")), false);
  assert.equal(campaignOpen(c, at("2026-10-31T20:00:00Z")), true, "the end date is included");
  assert.equal(campaignOpen(c, at("2026-11-01T01:00:00Z")), false);
  assert.equal(campaignOpen({ ...c, active: false }, at("2026-10-10T00:00:00Z")), false);
  assert.equal(campaignOpen({ ...c, endsOn: null }, at("2030-01-01T00:00:00Z")), true);
  const now = at("2026-10-20T00:00:00Z");
  assert.equal(attributionOpen(addDays(now, -29).getTime(), 30, now), true);
  assert.equal(attributionOpen(addDays(now, -31).getTime(), 30, now), false);
  assert.equal(attributionOpen(addDays(now, 3).getTime(), 30, now), false, "a link cannot have been followed in the future");
  assert.equal(attributionOpen(Number.NaN, 30, now), false);
  assert.equal(qualifyingOpen(addDays(now, -59), 60, now), true);
  assert.equal(qualifyingOpen(addDays(now, -61), 60, now), false);
});

test("the same mailbox is recognised through dots and plus tags; signals ask for a look and accuse no one", () => {
  assert.equal(normaliseEmail("Tunde.Okafor+promo@Gmail.com"), "tundeokafor@gmail.com");
  assert.equal(normaliseEmail("tunde.okafor@googlemail.com"), "tundeokafor@gmail.com");
  assert.equal(normaliseEmail("tunde.okafor+x@firm.ng"), "tunde.okafor@firm.ng", "dots matter for other providers");
  const base = { referrer: { email: "a.b@gmail.com", name: "Ada Bello", createdAt: new Date("2026-01-01T00:00:00Z") }, referred: { email: "other@example.com", name: "Chidi Eze" }, referrerSignupsLast24h: 1, burstLimit: 10, now: new Date("2026-10-01T00:00:00Z") };
  assert.deepEqual(referralSignals(base), []);
  assert.deepEqual(referralSignals({ ...base, referred: { email: "ab+2@gmail.com", name: "Chidi Eze" } }), ["SAME_EMAIL_ROOT"]);
  assert.deepEqual(referralSignals({ ...base, referred: { email: "x@y.ng", name: "  ada   BELLO " } }), ["SAME_NAME"]);
  assert.deepEqual(referralSignals({ ...base, referrerSignupsLast24h: 10 }), ["BURST"]);
  assert.deepEqual(referralSignals({ ...base, referrer: { ...base.referrer, createdAt: new Date("2026-09-30T23:30:00Z") } }), ["NEW_REFERRER"]);
});

test("names are masked for the referrer, and codes have one shape", () => {
  assert.equal(maskName("Tunde Okafor"), "T*** O.");
  assert.equal(maskName("Tunde"), "T***");
  assert.equal(maskName("  "), "Someone");
  assert.equal(isCodeShape("ABCD2345"), true);
  assert.equal(isCodeShape("ABCD2340"), false, "0 and O are not used");
  assert.equal(isCodeShape("abcd2345"), false);
});
