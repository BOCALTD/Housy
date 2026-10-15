import { test } from "node:test";
import assert from "node:assert/strict";
import { accessFor, explainState, hasContactDetails, maskContactDetails, nextChange, subscriptionState, weakest } from "../../src/lib/subscription-rules";

const end = new Date("2026-10-01T00:00:00Z");
const policy = { graceDays: 7, readOnlyDays: 30 };
const at = (days: number) => new Date(end.getTime() + days * 864e5);

test("a subscription moves from active to grace, read-only and suspended on the plan's dates", () => {
  const sub = { status: "ACTIVE" as const, periodEnd: end };
  assert.equal(subscriptionState(sub, policy, at(-1)), "ACTIVE");
  assert.equal(subscriptionState(sub, policy, at(0)), "ACTIVE");
  assert.equal(subscriptionState(sub, policy, at(3)), "GRACE");
  assert.equal(subscriptionState(sub, policy, at(7)), "GRACE");
  assert.equal(subscriptionState(sub, policy, at(8)), "READ_ONLY");
  assert.equal(subscriptionState(sub, policy, at(37)), "READ_ONLY");
  assert.equal(subscriptionState(sub, policy, at(38)), "SUSPENDED");
  assert.equal(subscriptionState({ status: "TRIAL", periodEnd: end }, policy, at(-2)), "TRIAL");
  assert.equal(subscriptionState(null, policy), "NONE");
  assert.equal(subscriptionState(sub, null), "NONE");
});

test("a cancelled subscription runs to the end of its period and has no grace", () => {
  const sub = { status: "CANCELLED" as const, periodEnd: end };
  assert.equal(subscriptionState(sub, policy, at(-5)), "ACTIVE");
  assert.equal(subscriptionState(sub, policy, at(1)), "NONE");
  assert.equal(nextChange(sub, policy, at(-5))?.becomes, "NONE");
  assert.equal(nextChange(sub, policy, at(1)), null);
});

test("a plan with no grace or read-only days goes straight to suspended", () => {
  const sub = { status: "ACTIVE" as const, periodEnd: end };
  assert.equal(subscriptionState(sub, { graceDays: 0, readOnlyDays: 0 }, at(1)), "SUSPENDED");
  assert.equal(nextChange(sub, { graceDays: 0, readOnlyDays: 0 }, at(-1))?.becomes, "SUSPENDED");
});

test("access follows the state, and a workspace follows the weaker party", () => {
  assert.deepEqual(["TRIAL", "ACTIVE", "GRACE", "READ_ONLY", "SUSPENDED", "NONE"].map((s) => accessFor(s as never)), ["FULL", "FULL", "FULL", "READ_ONLY", "NONE", "NONE"]);
  assert.equal(weakest("FULL", "READ_ONLY"), "READ_ONLY");
  assert.equal(weakest("FULL", "NONE", "READ_ONLY"), "NONE");
  assert.equal(weakest("FULL"), "FULL");
  assert.equal(weakest(), "FULL");
});

test("the next change is dated and explained", () => {
  const sub = { status: "ACTIVE" as const, periodEnd: end };
  assert.deepEqual(nextChange(sub, policy, at(-3)), { on: end, becomes: "GRACE" });
  assert.deepEqual(nextChange(sub, policy, at(2)), { on: at(7), becomes: "READ_ONLY" });
  assert.deepEqual(nextChange(sub, policy, at(10)), { on: at(37), becomes: "SUSPENDED" });
  assert.equal(nextChange(sub, policy, at(40)), null);
  assert.match(explainState("READ_ONLY", "Your plan"), /cannot add or change/);
});

test("phone numbers and email addresses are found and hidden", () => {
  assert.equal(hasContactDetails("Call me on 0803 123 4567"), true);
  assert.equal(hasContactDetails("+234 803 123 4567"), true);
  assert.equal(hasContactDetails("write to ada@example.com"), true);
  assert.equal(hasContactDetails("The plot is 450 square metres and costs 25,000,000"), false);
  assert.equal(hasContactDetails("See you at 10:30 on 14 November"), false);
  const m = maskContactDetails("Ring 08031234567 or mail ada@example.com today");
  assert.equal(m, "Ring [phone hidden] or mail [email hidden] today");
  assert.equal(hasContactDetails(m), false);
});
