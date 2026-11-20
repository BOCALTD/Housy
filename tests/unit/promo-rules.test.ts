import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPromo, normaliseCode, promoProblem, type PromoLike } from "../../src/lib/promo-rules";

const base: PromoLike = { code: "LAUNCH25", percentOff: 25, amountOffMinor: null, currency: "NGN", planIds: [], maxRedemptions: null, startsAt: null, endsAt: null, active: true };
const now = new Date("2026-11-20T10:00:00Z");
const ok = { planId: "p1", currency: "NGN", used: 0, now };

test("codes are the same however they are typed", () => {
  assert.equal(normaliseCode(" launch-25 "), "LAUNCH25");
  assert.equal(normaliseCode("Launch 25!"), "LAUNCH25");
  assert.equal(normaliseCode("x".repeat(50)).length, 30);
});

test("percent and amount discounts never go below zero or above the price", () => {
  assert.deepEqual(applyPromo(base, 1_000_000n), { discount: 250_000n, pay: 750_000n });
  assert.deepEqual(applyPromo({ percentOff: 100, amountOffMinor: null }, 500n), { discount: 500n, pay: 0n });
  assert.deepEqual(applyPromo({ percentOff: null, amountOffMinor: 900n }, 500n), { discount: 500n, pay: 0n });
  assert.deepEqual(applyPromo({ percentOff: null, amountOffMinor: 100n }, 500n), { discount: 100n, pay: 400n });
  assert.deepEqual(applyPromo({ percentOff: null, amountOffMinor: null }, 500n), { discount: 0n, pay: 500n });
});

test("a code is refused, in plain words, when it cannot be used", () => {
  assert.equal(promoProblem(base, ok), null);
  assert.match(promoProblem({ ...base, active: false }, ok)!, /no longer active/);
  assert.match(promoProblem({ ...base, startsAt: new Date("2026-12-01") }, ok)!, /cannot be used yet/);
  assert.match(promoProblem({ ...base, endsAt: new Date("2026-11-01") }, ok)!, /expired/);
  assert.match(promoProblem({ ...base, planIds: ["p2"] }, ok)!, /not for this plan/);
  assert.match(promoProblem({ ...base, maxRedemptions: 3 }, { ...ok, used: 3 })!, /used up/);
  assert.equal(promoProblem({ ...base, maxRedemptions: 3 }, { ...ok, used: 2 }), null);
  assert.match(promoProblem({ ...base, percentOff: null, amountOffMinor: 100n, currency: "USD" }, ok)!, /prices in USD/);
  // A percentage works whatever the currency.
  assert.equal(promoProblem(base, { ...ok, currency: "GHS" }), null);
});
