import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNairaToKobo, formatKobo } from "../../src/lib/money";
import { parseDateOnly, addMonthsClamped, toDateOnlyString, todayInLagos } from "../../src/lib/dates";
import { generateRentSchedule, chargeState, applyPayment } from "../../src/lib/rent";
import { can } from "../../src/lib/permissions";

const d = parseDateOnly;
const s = toDateOnlyString;

test("parses naira into kobo without floating point", () => {
  assert.equal(parseNairaToKobo("185,000,000"), 18_500_000_000n);
  assert.equal(parseNairaToKobo("₦1,500.5"), 150_050n);
  assert.equal(parseNairaToKobo("0.07"), 7n);
  assert.equal(parseNairaToKobo("NGN 2,000"), 200_000n);
  assert.throws(() => parseNairaToKobo("12.345"));
  assert.throws(() => parseNairaToKobo("-5"));
  assert.throws(() => parseNairaToKobo("abc"));
});

test("formats kobo as naira", () => {
  assert.equal(formatKobo(18_500_000_000n), "₦185,000,000");
  assert.equal(formatKobo(150_050n), "₦1,500.50");
  assert.equal(formatKobo(5n), "₦0.05");
  assert.equal(formatKobo("650000000"), "₦6,500,000");
});

test("rejects impossible dates", () => {
  assert.throws(() => d("2026-02-30"));
  assert.throws(() => d("26-1-1"));
  assert.equal(s(d("2028-02-29")), "2028-02-29");
});

test("month addition clamps to month end without drifting", () => {
  assert.equal(s(addMonthsClamped(d("2026-01-31"), 1)), "2026-02-28");
  assert.equal(s(addMonthsClamped(d("2026-01-31"), 2)), "2026-03-31");
  assert.equal(s(addMonthsClamped(d("2027-11-30"), 3)), "2028-02-29");
  assert.equal(s(addMonthsClamped(d("2026-12-15"), 1)), "2027-01-15");
});

test("yearly lease produces one charge per year, in advance", () => {
  const charges = generateRentSchedule({ startDate: d("2026-03-01"), endDate: d("2028-03-01"), frequency: "YEARLY", rentKobo: 650_000_000n });
  assert.deepEqual(charges.map((c) => s(c.dueDate)), ["2026-03-01", "2027-03-01"]);
  assert.ok(charges.every((c) => c.amountKobo === 650_000_000n));
});

test("monthly lease from the 31st keeps month-end due dates", () => {
  const charges = generateRentSchedule({ startDate: d("2026-01-31"), endDate: d("2026-05-01"), frequency: "MONTHLY", rentKobo: 100n });
  assert.deepEqual(charges.map((c) => s(c.dueDate)), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
});

test("quarterly and half-yearly schedules", () => {
  assert.equal(generateRentSchedule({ startDate: d("2026-01-01"), endDate: d("2027-01-01"), frequency: "QUARTERLY", rentKobo: 1n }).length, 4);
  assert.equal(generateRentSchedule({ startDate: d("2026-01-01"), endDate: d("2027-01-01"), frequency: "HALF_YEARLY", rentKobo: 1n }).length, 2);
  assert.equal(generateRentSchedule({ startDate: d("2026-01-01"), endDate: d("2026-01-02"), frequency: "YEARLY", rentKobo: 1n }).length, 1);
});

test("schedule rejects invalid terms", () => {
  assert.throws(() => generateRentSchedule({ startDate: d("2026-01-01"), endDate: d("2026-01-01"), frequency: "MONTHLY", rentKobo: 1n }));
  assert.throws(() => generateRentSchedule({ startDate: d("2026-01-01"), endDate: d("2027-01-01"), frequency: "MONTHLY", rentKobo: 0n }));
});

test("charge states and overdue detection", () => {
  const today = d("2026-06-15");
  assert.equal(chargeState({ amountKobo: 100n, paidKobo: 100n, dueDate: d("2026-01-01") }, today), "PAID");
  assert.equal(chargeState({ amountKobo: 100n, paidKobo: 40n, dueDate: d("2026-06-01") }, today), "OVERDUE");
  assert.equal(chargeState({ amountKobo: 100n, paidKobo: 40n, dueDate: d("2026-07-01") }, today), "PART_PAID");
  assert.equal(chargeState({ amountKobo: 100n, paidKobo: 0n, dueDate: d("2026-06-15") }, today), "DUE");
});

test("payments cannot exceed the outstanding amount", () => {
  assert.equal(applyPayment({ amountKobo: 100n, paidKobo: 40n }, 60n), 100n);
  assert.throws(() => applyPayment({ amountKobo: 100n, paidKobo: 40n }, 61n));
  assert.throws(() => applyPayment({ amountKobo: 100n, paidKobo: 100n }, 1n));
  assert.throws(() => applyPayment({ amountKobo: 100n, paidKobo: 0n }, 0n));
});

test("today is computed in West Africa Time", () => {
  // 23:30 UTC on 31 Dec is already 1 Jan in Lagos (UTC+1).
  assert.equal(s(todayInLagos(new Date("2026-12-31T23:30:00Z"))), "2027-01-01");
});

test("permission matrix keeps viewers read-only and team management with the super admin", () => {
  assert.equal(can("VIEWER", "asset.view"), true);
  assert.equal(can("VIEWER", "task.create"), false);
  assert.equal(can("OFFICER", "payment.record"), false);
  assert.equal(can("MANAGER", "team.manage"), false);
  assert.equal(can("COMPANY_SUPER_ADMIN", "team.manage"), true);
});

test("hosted deployments connect as the restricted runtime role", async () => {
  const { runtimeDatabaseUrl } = await import("../../src/lib/db-url");
  const url = runtimeDatabaseUrl("postgresql://neondb_owner:ownerpw@ep-cool-1-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require", "p@ss/word");
  const u = new URL(url!);
  assert.equal(u.username, "estate_app");
  assert.equal(decodeURIComponent(u.password), "p@ss/word");
  assert.equal(u.searchParams.get("pgbouncer"), "true");
  assert.equal(u.searchParams.get("sslmode"), "require");
  assert.equal(runtimeDatabaseUrl("postgresql://a:b@localhost/db", ""), undefined, "no password means no rewrite");
});

test("correspondence references follow PREFIX/DEPT/YEAR/SEQUENCE", async () => {
  const { formatReference, cleanCode } = await import("../../src/lib/correspondence-rules");
  assert.equal(formatReference("alp", "leg", 2026, 7), "ALP/LEG/2026/0007");
  assert.equal(formatReference("ALP", null, 2026, 12345), "ALP/2026/12345");
  assert.equal(formatReference("", null, 2026, 1), "REF/2026/0001");
  assert.equal(cleanCode("a/b c-9"), "ABC9");
});

test("correspondence moves only through allowed steps", async () => {
  const { nextStatus, allowedActions, isOverdue } = await import("../../src/lib/correspondence-rules");
  assert.equal(nextStatus("assign", "REGISTERED"), "ASSIGNED");
  assert.equal(nextStatus("submit_for_approval", "DRAFT_RESPONSE"), "AWAITING_APPROVAL");
  assert.throws(() => nextStatus("dispatch", "DRAFT_RESPONSE"), /cannot be moved/);
  assert.throws(() => nextStatus("approve", "REGISTERED"));
  assert.throws(() => nextStatus("close", "CLOSED"));
  assert.throws(() => nextStatus("close", "AWAITING_APPROVAL"), "a letter awaiting approval must be approved or returned first");
  assert.deepEqual(allowedActions("AWAITING_APPROVAL").sort(), ["approve", "return_to_draft"]);
  const today = new Date(Date.UTC(2026, 9, 12));
  const past = new Date(Date.UTC(2026, 9, 1));
  assert.equal(isOverdue("UNDER_REVIEW", past, today), true);
  assert.equal(isOverdue("SENT", past, today), false, "a sent reply is no longer overdue");
  assert.equal(isOverdue("UNDER_REVIEW", null, today), false);
});

// ---------- Phase 5a: rent ledger rules ----------

test("custom payment frequency needs a sensible interval", async () => {
  const { periodMonths } = await import("../../src/lib/rent");
  assert.equal(periodMonths("QUARTERLY"), 3);
  assert.equal(periodMonths("CUSTOM", 2), 2);
  assert.throws(() => periodMonths("CUSTOM", null), /1 to 120 months/);
  assert.throws(() => periodMonths("CUSTOM", 0));
  assert.throws(() => periodMonths("CUSTOM", 121));
  assert.throws(() => periodMonths("CUSTOM", 1.5));
  const charges = generateRentSchedule({ startDate: d("2026-01-01"), endDate: d("2026-12-31"), frequency: "CUSTOM", intervalMonths: 5, rentKobo: 10n });
  assert.deepEqual(charges.map((c) => s(c.dueDate)), ["2026-01-01", "2026-06-01", "2026-11-01"]);
});

test("grace days move the overdue boundary, and adjustments change what is owed", async () => {
  const { daysOverdue, outstandingOf, effectiveAmount } = await import("../../src/lib/rent");
  const due = d("2026-06-01");
  const c = { amountKobo: 100n, adjustedKobo: 0n, paidKobo: 0n, dueDate: due };
  // Due 1 June with 5 grace days: on time through 6 June, overdue from 7 June.
  assert.equal(chargeState(c, d("2026-06-06"), 5), "DUE");
  assert.equal(chargeState(c, d("2026-06-07"), 5), "OVERDUE");
  assert.equal(chargeState(c, d("2026-06-01"), 0), "DUE");
  assert.equal(chargeState(c, d("2026-06-02"), 0), "OVERDUE");
  assert.equal(daysOverdue(c, d("2026-06-06"), 5), 0);
  assert.equal(daysOverdue(c, d("2026-06-07"), 5), 1);
  assert.equal(daysOverdue(c, d("2026-07-01"), 0), 30);
  assert.equal(daysOverdue({ ...c, paidKobo: 100n }, d("2026-07-01"), 0), 0, "a paid charge is never overdue");
  // A late fee raises the amount due; paying the original amount leaves the fee outstanding.
  const withFee = { ...c, adjustedKobo: 10n, paidKobo: 100n };
  assert.equal(effectiveAmount(withFee), 110n);
  assert.equal(outstandingOf(withFee), 10n);
  assert.equal(chargeState(withFee, d("2026-06-01"), 0), "PART_PAID");
  // A full waiver is WAIVED, not PAID; a partial waiver reduces what is owed.
  assert.equal(chargeState({ ...c, adjustedKobo: -100n }, d("2026-06-02"), 0), "WAIVED");
  assert.equal(outstandingOf({ ...c, adjustedKobo: -40n, paidKobo: 60n }), 0n);
  assert.equal(chargeState({ ...c, adjustedKobo: -40n, paidKobo: 60n }, d("2026-06-02"), 0), "PAID");
  assert.equal(applyPayment({ amountKobo: 100n, adjustedKobo: 10n, paidKobo: 100n }, 10n), 110n);
  assert.throws(() => applyPayment({ amountKobo: 100n, adjustedKobo: -40n, paidKobo: 60n }, 1n), /fully paid/);
});

test("payment references are compared without regard to case, spaces or punctuation", async () => {
  const { evidenceKey, receiptStatus, formatReceiptNo } = await import("../../src/lib/ledger-rules");
  assert.equal(evidenceKey("GTB Transfer 0001"), evidenceKey("gtb-transfer/0001"));
  assert.notEqual(evidenceKey("GTB 0001"), evidenceKey("GTB 0002"));
  assert.equal(evidenceKey("--"), "");
  assert.equal(receiptStatus({ reversed: false, reconciled: false }), "RECORDED");
  assert.equal(receiptStatus({ reversed: false, reconciled: true }), "RECONCILED");
  assert.equal(receiptStatus({ reversed: true, reconciled: true }), "REVERSED");
  assert.equal(formatReceiptNo(2026, 7), "RCT-2026-00007");
});

test("a payment is applied to the oldest charges first and splits exactly", async () => {
  const { allocatePayment } = await import("../../src/lib/ledger-rules");
  const charges = [
    { id: "c3", dueDate: d("2026-07-01"), outstandingKobo: 100n },
    { id: "c1", dueDate: d("2026-01-01"), outstandingKobo: 40n },
    { id: "c2", dueDate: d("2026-04-01"), outstandingKobo: 100n },
    { id: "paid", dueDate: d("2025-10-01"), outstandingKobo: 0n },
  ];
  const a = allocatePayment(charges, 150n);
  assert.deepEqual(a, [{ chargeId: "c1", amountKobo: 40n }, { chargeId: "c2", amountKobo: 100n }, { chargeId: "c3", amountKobo: 10n }]);
  assert.equal(a.reduce((x, y) => x + y.amountKobo, 0n), 150n);
  assert.deepEqual(allocatePayment(charges, 1n), [{ chargeId: "c1", amountKobo: 1n }]);
  assert.equal(allocatePayment(charges, 240n).length, 3, "the whole balance can be paid in advance");
  assert.throws(() => allocatePayment(charges, 241n), /more than the total outstanding/);
  assert.throws(() => allocatePayment(charges, 0n));
  assert.throws(() => allocatePayment([{ id: "x", dueDate: d("2026-01-01"), outstandingKobo: 0n }], 1n), /Nothing is outstanding/);
  // Charges due the same day are ordered by id so the result is deterministic.
  const tie = allocatePayment([{ id: "b", dueDate: d("2026-01-01"), outstandingKobo: 5n }, { id: "a", dueDate: d("2026-01-01"), outstandingKobo: 5n }], 6n);
  assert.deepEqual(tie, [{ chargeId: "a", amountKobo: 5n }, { chargeId: "b", amountKobo: 1n }]);
});

test("adjustments have a direction and cannot go below what has been paid", async () => {
  const { signedAdjustment, checkAdjustmentFits } = await import("../../src/lib/ledger-rules");
  assert.equal(signedAdjustment("LATE_FEE", undefined, 50n), 50n);
  assert.equal(signedAdjustment("LATE_FEE", "DECREASE", 50n), 50n, "a late fee always adds");
  assert.equal(signedAdjustment("WAIVER", undefined, 50n), -50n);
  assert.equal(signedAdjustment("CREDIT_NOTE", "INCREASE", 50n), -50n, "a credit note always reduces");
  assert.equal(signedAdjustment("CORRECTION", "INCREASE", 50n), 50n);
  assert.equal(signedAdjustment("CORRECTION", "DECREASE", 50n), -50n);
  assert.throws(() => signedAdjustment("CORRECTION", undefined, 50n), /increases or decreases/);
  assert.throws(() => signedAdjustment("WAIVER", undefined, 0n));
  const c = { amountKobo: 100n, adjustedKobo: 0n, paidKobo: 60n };
  assert.doesNotThrow(() => checkAdjustmentFits(c, -40n));
  assert.throws(() => checkAdjustmentFits(c, -41n), /more than the amount still unpaid/);
  assert.doesNotThrow(() => checkAdjustmentFits(c, 25n));
});

test("the deposit ledger enforces the agreed amount, the balance and the end of the tenancy", async () => {
  const { depositTotals, checkDepositEntry } = await import("../../src/lib/ledger-rules");
  const totals = depositTotals([
    { kind: "RECEIVED", amountKobo: 200n }, { kind: "DEDUCTION", amountKobo: 30n }, { kind: "REFUND", amountKobo: 50n },
  ]);
  assert.deepEqual(totals, { received: 200n, deducted: 30n, refunded: 50n, balance: 120n });
  const base = { agreedKobo: 250n, totals: { received: 200n, balance: 120n } };
  assert.doesNotThrow(() => checkDepositEntry({ ...base, kind: "RECEIVED", amountKobo: 50n, tenancyEnded: false }));
  assert.throws(() => checkDepositEntry({ ...base, kind: "RECEIVED", amountKobo: 51n, tenancyEnded: false }), /above the agreed/);
  assert.throws(() => checkDepositEntry({ ...base, agreedKobo: 0n, kind: "RECEIVED", amountKobo: 1n, tenancyEnded: false }), /No deposit was agreed/);
  assert.throws(() => checkDepositEntry({ ...base, kind: "REFUND", amountKobo: 10n, tenancyEnded: false }), /once the tenancy has ended/);
  assert.doesNotThrow(() => checkDepositEntry({ ...base, kind: "REFUND", amountKobo: 120n, tenancyEnded: true }));
  assert.throws(() => checkDepositEntry({ ...base, kind: "DEDUCTION", amountKobo: 121n, tenancyEnded: true }), /more than the deposit still held/);
});

test("units: a blank unit means the whole property", async () => {
  const { unitsConflict } = await import("../../src/lib/ledger-rules");
  assert.equal(unitsConflict("", ""), true);
  assert.equal(unitsConflict("", "Flat 3B"), true);
  assert.equal(unitsConflict("Flat 3B", ""), true);
  assert.equal(unitsConflict("Flat 3B", " flat 3b "), true);
  assert.equal(unitsConflict("Flat 3B", "Flat 3C"), false);
});

test("overdue amounts fall into ageing buckets at the boundaries", async () => {
  const { ageingBucket } = await import("../../src/lib/ledger-rules");
  assert.equal(ageingBucket(1), "1-30 days");
  assert.equal(ageingBucket(30), "1-30 days");
  assert.equal(ageingBucket(31), "31-60 days");
  assert.equal(ageingBucket(60), "31-60 days");
  assert.equal(ageingBucket(61), "61-90 days");
  assert.equal(ageingBucket(90), "61-90 days");
  assert.equal(ageingBucket(91), "Over 90 days");
});

// ---------- Phase 5b/5c rules ----------
import { allocateBudget, assessmentBalance, checkClosure, checkRenewalPeriod, fundPosition, noticeAdequacy } from "../../src/lib/ledger-rules";

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

test("service charge shares add up to the budget exactly, whatever the split", () => {
  const equal = allocateBudget(1_000_000n, "EQUAL", [{ id: "a", floorAreaSqm: null }, { id: "b", floorAreaSqm: null }, { id: "c", floorAreaSqm: null }]);
  assert.equal(equal.reduce((s, r) => s + r.amountKobo, 0n), 1_000_000n);
  assert.deepEqual(equal.map((r) => r.amountKobo), [333_334n, 333_333n, 333_333n]);

  const area = allocateBudget(1_000_001n, "FLOOR_AREA", [{ id: "x", floorAreaSqm: 30 }, { id: "y", floorAreaSqm: 70 }, { id: "z", floorAreaSqm: 17 }]);
  assert.equal(area.reduce((s, r) => s + r.amountKobo, 0n), 1_000_001n);
  assert.ok(area.find((r) => r.id === "y")!.amountKobo > area.find((r) => r.id === "x")!.amountKobo);

  // Same input, same output: ties are broken by id, not by order.
  const one = allocateBudget(100n, "EQUAL", [{ id: "b", floorAreaSqm: null }, { id: "a", floorAreaSqm: null }, { id: "c", floorAreaSqm: null }]);
  const two = allocateBudget(100n, "EQUAL", [{ id: "c", floorAreaSqm: null }, { id: "a", floorAreaSqm: null }, { id: "b", floorAreaSqm: null }]);
  const byId = (r: { id: string; amountKobo: bigint }[]) => Object.fromEntries(r.map((x) => [x.id, x.amountKobo]));
  assert.deepEqual(byId(one), byId(two));
  assert.equal(byId(one).a, 34n);
});

test("service charge allocation rejects what cannot be shared fairly", () => {
  assert.throws(() => allocateBudget(0n, "EQUAL", [{ id: "a", floorAreaSqm: null }]), /more than zero/);
  assert.throws(() => allocateBudget(100n, "EQUAL", []), /No active leases/);
  assert.throws(() => allocateBudget(100n, "FLOOR_AREA", [{ id: "a", floorAreaSqm: 10 }, { id: "b", floorAreaSqm: null }]), /floor area/);
  assert.throws(() => allocateBudget(100n, "FIXED", [{ id: "a", floorAreaSqm: null, fixedKobo: 60n }, { id: "b", floorAreaSqm: null, fixedKobo: 30n }]), /exactly the budget/);
  assert.throws(() => allocateBudget(100n, "FIXED", [{ id: "a", floorAreaSqm: null, fixedKobo: 60n }, { id: "b", floorAreaSqm: null }]), /every lease/);
  assert.deepEqual(allocateBudget(100n, "FIXED", [{ id: "a", floorAreaSqm: null, fixedKobo: 60n }, { id: "b", floorAreaSqm: null, fixedKobo: 40n }]).map((r) => r.amountKobo), [60n, 40n]);
});

test("assessment balances ignore reversed collections, and the fund stays separate from the budget", () => {
  const b = assessmentBalance(1_000n, [{ amountKobo: 400n, reversed: false }, { amountKobo: 300n, reversed: true }]);
  assert.equal(b.collected, 400n);
  assert.equal(b.outstanding, 600n);
  const f = fundPosition({ collectedKobo: 500n, approvedExpensesKobo: 200n, pendingExpensesKobo: 400n, budgetKobo: 1_000n });
  assert.equal(f.balance, 300n);
  assert.equal(f.afterPending, -100n);
  assert.equal(f.overBudget, false);
  assert.equal(fundPosition({ collectedKobo: 0n, approvedExpensesKobo: 1_001n, pendingExpensesKobo: 0n, budgetKobo: 1_000n }).overBudget, true);
});

test("notice adequacy, renewal period and closure rules", () => {
  assert.deepEqual(noticeAdequacy(day("2026-01-01"), day("2026-04-01"), 90), { days: 90, requiredDays: 90, short: false });
  assert.equal(noticeAdequacy(day("2026-01-01"), day("2026-03-31"), 90).short, true);
  assert.equal(checkRenewalPeriod(day("2026-12-31"), day("2026-12-30"), day("2027-12-31")), "The renewal cannot start before the current lease ends");
  assert.equal(checkRenewalPeriod(day("2026-12-31"), day("2026-12-31"), day("2026-12-31")), "The renewal must end after it starts");
  assert.equal(checkRenewalPeriod(day("2026-12-31"), day("2026-12-31"), day("2027-12-31")), null);
  const base = { outcome: "TERMINATED" as const, closedOn: day("2026-06-01"), today: day("2026-06-01"), startDate: day("2026-01-01"), endDate: day("2027-01-01"), reason: "Tenant left", hasMoveOut: true, status: "ACTIVE" };
  assert.equal(checkClosure(base), null);
  assert.match(checkClosure({ ...base, hasMoveOut: false })!, /move-out/);
  assert.match(checkClosure({ ...base, status: "ENDED" })!, /already closed/);
  assert.match(checkClosure({ ...base, closedOn: day("2026-06-02") })!, /future/);
  assert.match(checkClosure({ ...base, closedOn: day("2025-12-31") })!, /before the lease started/);
  assert.match(checkClosure({ ...base, outcome: "ENDED" })!, /not reached its end date/);
  assert.equal(checkClosure({ ...base, outcome: "ENDED", today: day("2027-01-01"), closedOn: day("2027-01-01") }), null);
});

// ---------- Phase 5d rules ----------
import { classifyDeadline } from "../../src/lib/deadlines";
import { csvCell, koboToPlain, toCsv } from "../../src/lib/csv";

test("deadlines move from later to due soon, overdue and escalated on exact day boundaries", () => {
  const today = day("2026-06-10");
  const c = (due: string) => classifyDeadline(day(due), today, 30, 7);
  assert.deepEqual(c("2026-07-11"), { state: "LATER", days: 31 });
  assert.deepEqual(c("2026-07-10"), { state: "DUE_SOON", days: 30 });
  assert.deepEqual(c("2026-06-10"), { state: "DUE_SOON", days: 0 });
  assert.deepEqual(c("2026-06-09"), { state: "OVERDUE", days: -1 });
  assert.deepEqual(c("2026-06-04"), { state: "OVERDUE", days: -6 });
  assert.deepEqual(c("2026-06-03"), { state: "ESCALATED", days: -7 });
});

test("CSV output escapes cells and neutralises spreadsheet formulas", () => {
  assert.equal(csvCell('He said "hi", twice'), '"He said ""hi"", twice"');
  assert.equal(csvCell("=HYPERLINK(\"x\")"), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell("+1"), "'+1");
  assert.equal(csvCell(-5), "-5");
  assert.equal(csvCell(null), "");
  assert.equal(toCsv(["a", "b"], [["x", 1n]]), "a,b\r\nx,1\r\n");
  assert.equal(koboToPlain(123456n), "1234.56");
  assert.equal(koboToPlain(5n), "0.05");
  assert.equal(koboToPlain(-150n), "-1.50");
});

// ---------- Phase 6a rules ----------
import { conditionChange, inspectionWarnings, parseChecklist, STARTER_TEMPLATES, submissionProblem } from "../../src/lib/inspection-rules";

test("inspection warnings flag ratings that disagree with the findings, without blocking", () => {
  const none = inspectionWarnings({ rating: "GOOD", responses: [{ result: "PASS", note: "" }], findings: [] });
  assert.deepEqual(none, []);
  const w = inspectionWarnings({
    rating: "GOOD",
    responses: [{ result: "FAIL", note: "" }, { result: "ATTENTION", note: "" }],
    findings: [{ severity: "CRITICAL", safetyRisk: true, recommendedAction: "" }],
  });
  assert.ok(w.some((x) => /although 1 checklist item failed/.test(x)));
  assert.ok(w.some((x) => /serious finding was recorded/.test(x)));
  assert.ok(w.some((x) => /critical finding/.test(x)));
  assert.ok(w.some((x) => /no note/.test(x)));
  assert.ok(w.some((x) => /safety risk has no recommended action/.test(x)));
  assert.ok(inspectionWarnings({ rating: "POOR", responses: [{ result: "PASS", note: "" }], findings: [] }).some((x) => /explain it/.test(x)));
  assert.ok(inspectionWarnings({ rating: "FAIR", responses: [{ result: "FAIL", note: "x" }], findings: [] }).some((x) => /no finding was recorded/.test(x)));
});

test("an inspection can be submitted only when complete, and condition change is signed", () => {
  const ok = { conductedOn: day("2026-05-01"), today: day("2026-05-02"), rating: "FAIR" as const, summary: "Minor leaks", responses: [{ result: "PASS" as const }] };
  assert.equal(submissionProblem(ok), null);
  assert.match(submissionProblem({ ...ok, conductedOn: null })!, /date/);
  assert.match(submissionProblem({ ...ok, conductedOn: day("2026-05-03") })!, /future/);
  assert.match(submissionProblem({ ...ok, responses: [{ result: "PENDING" }] })!, /every checklist item/);
  assert.match(submissionProblem({ ...ok, rating: null })!, /rating/);
  assert.match(submissionProblem({ ...ok, summary: "ok" })!, /summary/);
  assert.equal(conditionChange("GOOD", "POOR"), 2);
  assert.equal(conditionChange("POOR", "GOOD"), -2);
});

test("checklists parse from pasted lines and every asset class has a starter", () => {
  assert.deepEqual(parseChecklist("Roof | Gutters clear\n\nSecurity|Locks work\nPlain item here"), [
    { category: "Roof", prompt: "Gutters clear" }, { category: "Security", prompt: "Locks work" }, { category: "General", prompt: "Plain item here" },
  ]);
  assert.throws(() => parseChecklist("   \n"), /at least one/);
  assert.throws(() => parseChecklist("Roof | x"), /too short/);
  const classes = new Set(STARTER_TEMPLATES.map((t) => t.assetClass));
  for (const c of ["RESIDENTIAL", "COMMERCIAL", "LAND", "INDUSTRIAL", "PLANT_MACHINERY", "OTHER"]) assert.ok(classes.has(c as never), c);
  assert.ok(STARTER_TEMPLATES.every((t) => t.items.length >= 4));
});
