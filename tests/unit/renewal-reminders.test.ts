import { test } from "node:test";
import assert from "node:assert/strict";
import { daysLeft, renewalDue, renewalMessage, reminderStage, TRIAL_NOTICE_DAYS, RENEWAL_NOTICE_DAYS } from "../../src/lib/billing-rules";

const end = new Date("2026-12-10T12:00:00Z");
const at = (days: number) => new Date(end.getTime() + days * 864e5);

test("a trial is reminded 3 days before it ends, so a short trial is not asked to pay as it starts", () => {
  assert.equal(TRIAL_NOTICE_DAYS, 3);
  assert.equal(renewalDue({ periodEnd: end, graceDays: 7, now: at(-6), cancelled: false, trial: true }), false, "a 7-day trial on its first day");
  assert.equal(renewalDue({ periodEnd: end, graceDays: 7, now: at(-3), cancelled: false, trial: true }), true);
  assert.equal(renewalDue({ periodEnd: end, graceDays: 7, now: at(3), cancelled: false, trial: true }), true, "the 'trial has ended' notice can still go");
  assert.equal(renewalDue({ periodEnd: end, graceDays: 7, now: at(4), cancelled: false, trial: true }), false, "no grace window for a trial");
  // Paid plans keep the week's notice and the plan's grace.
  assert.equal(renewalDue({ periodEnd: end, graceDays: 7, now: at(-RENEWAL_NOTICE_DAYS), cancelled: false }), true);
  assert.equal(renewalDue({ periodEnd: end, graceDays: 7, now: at(7), cancelled: false }), true);
  assert.equal(renewalDue({ periodEnd: end, graceDays: 7, now: at(-3), cancelled: true }), false);
});

test("days left count up, and the stages follow", () => {
  assert.equal(daysLeft(end, at(-2.5)), 3);
  assert.equal(daysLeft(end, at(-0.2)), 1);
  assert.equal(daysLeft(end, at(1)), 0);
  assert.equal(reminderStage(end, at(-3)), "NOTICE");
  assert.equal(reminderStage(end, at(-0.5)), "LAST_DAY");
  assert.equal(reminderStage(end, at(0.5)), "OVERDUE");
});

test("reminders say what is ending, when, and what it costs, in plain words", () => {
  const t = renewalMessage({ planName: "Pro", stage: "NOTICE", trial: true, days: 3, amount: "₦10,000.00" });
  assert.equal(t.title, "Your free trial of Pro ends in 3 days");
  assert.match(t.body, /Choose Pro for ₦10,000.00/);
  assert.equal(renewalMessage({ planName: "Pro", stage: "NOTICE", trial: true, days: 1, amount: "x" }).title, "Your free trial of Pro ends in 1 day");
  assert.equal(renewalMessage({ planName: "Pro", stage: "LAST_DAY", trial: true, days: 1, amount: "x" }).title, "Your free trial of Pro ends today");
  assert.match(renewalMessage({ planName: "Pro", stage: "OVERDUE", trial: true, days: 0, amount: "x" }).body, /still see what you made/);
  assert.equal(renewalMessage({ planName: "Pro", stage: "NOTICE", trial: false, days: 7, amount: "x" }).title, "Your Pro plan ends in 7 days");
  assert.equal(renewalMessage({ planName: "Pro", stage: "OVERDUE", trial: false, days: 0, amount: "₦5" }).body, "Pay ₦5 now to keep your features.");
});

test("a year of a monthly plan costs the chosen number of months, and only monthly plans offer it", async () => {
  const { yearlyOffered, yearlyPrice, yearlySaving, YEARLY_DEFAULT_MONTHS } = await import("../../src/lib/billing-rules");
  assert.equal(YEARLY_DEFAULT_MONTHS, 10);
  assert.equal(yearlyPrice(500_000n, 10), 5_000_000n);
  assert.equal(yearlySaving(10), "2 months free");
  assert.equal(yearlySaving(11), "1 month free");
  assert.equal(yearlyOffered("MONTHLY", 10), true);
  assert.equal(yearlyOffered("MONTHLY", 0), false, "switched off");
  assert.equal(yearlyOffered("MONTHLY", 12), false, "no saving is no offer");
  assert.equal(yearlyOffered("QUARTERLY", 10), false);
  assert.equal(yearlyOffered("YEARLY", 10), false);
});
