import { test } from "node:test";
import assert from "node:assert/strict";
import { clientPaymentRef, commissionOf, isClientPaymentRef, nubanProblem, previousMonth } from "../../src/lib/client-payment-rules";

test("Housy's commission is the percentage of the amount, rounded to the kobo, and never the whole amount", () => {
  assert.equal(commissionOf(50_000_000n, 500), 2_500_000n, "5% of ₦500,000");
  assert.equal(commissionOf(1_000_000n, 1000), 100_000n);
  assert.equal(commissionOf(10n, 1500), 2n, "1.5 kobo rounds up");
  assert.equal(commissionOf(5_000n, 0), 0n);
  assert.equal(commissionOf(1n, 5000), 0n, "half a kobo of 1 kobo rounds to 1, which would be the whole amount, so 0");
  assert.throws(() => commissionOf(0n, 500));
  assert.throws(() => commissionOf(100n, 6000));
});

test("references, account numbers and the month commission is invoiced for", () => {
  const r = clientPaymentRef();
  assert.ok(isClientPaymentRef(r));
  assert.notEqual(r, clientPaymentRef());
  assert.ok(!isClientPaymentRef("CP-short"));
  assert.equal(nubanProblem("0123456789"), null);
  assert.match(nubanProblem("12345")!, /10-digit/);
  const m = previousMonth(new Date("2027-03-01T00:30:00+01:00"));
  assert.equal(m.label, "February 2027");
  assert.equal(m.from.toISOString(), "2027-01-31T23:00:00.000Z");
  assert.equal(m.to.toISOString(), "2027-02-28T23:00:00.000Z");
  assert.equal(previousMonth(new Date("2027-01-15T12:00:00Z")).label, "December 2026");
});
