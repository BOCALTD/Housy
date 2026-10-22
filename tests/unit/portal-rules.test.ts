import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptEffect, canMoveLead, canSubmit, checkSubmissionInput, leadNext, parseNaira, rentPosition, submittableKinds, vendorCanSee } from "../../src/lib/portal-rules";

test("vendors see jobs only from assignment onwards", () => {
  for (const s of ["REPORTED", "TRIAGED", "APPROVED", "CANCELLED"]) assert.equal(vendorCanSee(s), false, s);
  for (const s of ["ASSIGNED", "IN_PROGRESS", "COMPLETED", "CLOSED"]) assert.equal(vendorCanSee(s), true, s);
});

test("what a vendor may send depends on the stage of the job", () => {
  assert.deepEqual(submittableKinds("ASSIGNED"), ["QUOTE"]);
  assert.deepEqual(submittableKinds("IN_PROGRESS").sort(), ["COMPLETION", "INVOICE", "QUOTE"]);
  assert.deepEqual(submittableKinds("CLOSED"), ["INVOICE"]);
  assert.equal(canSubmit("COMPLETION", "COMPLETED"), false);
  assert.deepEqual(submittableKinds("REPORTED"), []);
});

test("naira amounts become kobo, and nonsense is refused", () => {
  assert.equal(parseNaira("150,000"), 15_000_000n);
  assert.equal(parseNaira("₦1,234.5"), 123_450n);
  assert.equal(parseNaira(" "), null);
  assert.throws(() => parseNaira("12abc"), /naira/);
  assert.throws(() => parseNaira("1.234"), /naira/);
});

test("submission checks", () => {
  assert.deepEqual(checkSubmissionInput("QUOTE", "ASSIGNED", 100n, ""), []);
  assert.match(checkSubmissionInput("QUOTE", "ASSIGNED", null, "").join(), /amount/);
  assert.match(checkSubmissionInput("QUOTE", "ASSIGNED", 0n, "").join(), /amount/);
  assert.match(checkSubmissionInput("INVOICE", "ASSIGNED", 100n, "").join(), /stage/);
  assert.match(checkSubmissionInput("COMPLETION", "IN_PROGRESS", null, "done").join(), /Describe/);
  assert.deepEqual(checkSubmissionInput("COMPLETION", "IN_PROGRESS", null, "Replaced both joints and tested"), []);
});

test("accepting a quotation sets the estimate; an invoice sets the actual cost; a completion report changes no money", () => {
  assert.deepEqual(acceptEffect("QUOTE", 500n), { estimatedCostKobo: 500n });
  assert.deepEqual(acceptEffect("INVOICE", 700n), { actualCostKobo: 700n });
  assert.deepEqual(acceptEffect("COMPLETION", null), {});
});

test("provider leads only move forward", () => {
  assert.deepEqual(leadNext("SUBMITTED"), ["CONTACTED", "DECLINED"]);
  assert.equal(canMoveLead("SUBMITTED", "CLOSED"), false);
  assert.equal(canMoveLead("CONTACTED", "IN_PROGRESS"), true);
  assert.deepEqual(leadNext("WITHDRAWN"), [], "a withdrawn request cannot be reopened by the provider");
  assert.deepEqual(leadNext("CLOSED"), []);
});

test("rent position counts what has fallen due, what was paid and what is outstanding", () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  const charges = [
    { dueDate: d("2026-01-01"), amountKobo: 1000n, adjustedKobo: 0n, paidKobo: 1000n },
    { dueDate: d("2026-04-01"), amountKobo: 1000n, adjustedKobo: -200n, paidKobo: 500n },
    { dueDate: d("2026-07-01"), amountKobo: 1000n, adjustedKobo: 0n, paidKobo: 0n },
    { dueDate: d("2026-10-01"), amountKobo: 1000n, adjustedKobo: 0n, paidKobo: 0n },
  ];
  const r = rentPosition(charges, d("2026-08-15"));
  assert.equal(r.dueKobo, 2800n);
  assert.equal(r.paidKobo, 1500n);
  assert.equal(r.overdueKobo, 1300n);
  assert.equal(r.nextDue?.toISOString().slice(0, 10), "2026-10-01");
});
