import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDateOnly } from "../../src/lib/dates";
import {
  activationProblems, budgetTotal, commitmentProblem, costSummary, extendedEnd, invoiceProblem, normaliseProgress, overallPercent, plannedPercent,
  scheduleWarnings, workState,
} from "../../src/lib/project-rules";

const d = parseDateOnly;

test("planned percent runs in a straight line from start to end", () => {
  assert.equal(plannedPercent(d("2026-01-01"), d("2026-01-10"), d("2025-12-31")), 0);
  assert.equal(plannedPercent(d("2026-01-01"), d("2026-01-10"), d("2026-01-01")), 10);
  assert.equal(plannedPercent(d("2026-01-01"), d("2026-01-10"), d("2026-01-05")), 50);
  assert.equal(plannedPercent(d("2026-01-01"), d("2026-01-10"), d("2026-01-10")), 100);
  assert.equal(plannedPercent(d("2026-01-01"), d("2026-01-10"), d("2026-02-01")), 100);
});

test("work package state", () => {
  const w = { status: "IN_PROGRESS" as const, percentComplete: 50, plannedStart: d("2026-01-01"), plannedEnd: d("2026-01-10") };
  assert.equal(workState(w, d("2026-01-05")), "ON_TRACK");
  assert.equal(workState({ ...w, percentComplete: 20 }, d("2026-01-05")), "BEHIND");
  assert.equal(workState(w, d("2026-01-11")), "LATE");
  assert.equal(workState({ ...w, status: "DONE", percentComplete: 100 }, d("2026-02-01")), "DONE");
  assert.equal(workState({ ...w, status: "BLOCKED" }, d("2026-01-05")), "BLOCKED");
  assert.equal(workState({ ...w, status: "NOT_STARTED", percentComplete: 0 }, d("2025-12-01")), "NOT_STARTED");
});

test("overall progress is weighted by budget, or equal when there are no budgets", () => {
  assert.equal(overallPercent([]), 0);
  assert.equal(overallPercent([{ percentComplete: 100, budgetKobo: 300n }, { percentComplete: 0, budgetKobo: 100n }]), 75);
  assert.equal(overallPercent([{ percentComplete: 100, budgetKobo: 0n }, { percentComplete: 0, budgetKobo: 0n }]), 50);
});

test("status and percentage stay consistent", () => {
  assert.deepEqual(normaliseProgress("DONE", 40), { status: "DONE", percentComplete: 100 });
  assert.deepEqual(normaliseProgress("IN_PROGRESS", 100), { status: "DONE", percentComplete: 100 });
  assert.deepEqual(normaliseProgress("NOT_STARTED", 30), { status: "IN_PROGRESS", percentComplete: 30 });
  assert.deepEqual(normaliseProgress("IN_PROGRESS", 0), { status: "NOT_STARTED", percentComplete: 0 });
  assert.deepEqual(normaliseProgress("BLOCKED", 40), { status: "BLOCKED", percentComplete: 40 });
  assert.throws(() => normaliseProgress("IN_PROGRESS", 101));
  assert.throws(() => normaliseProgress("IN_PROGRESS", 1.5));
});

test("cost summary: committed, invoiced, forecast, variance and contingency", () => {
  assert.equal(budgetTotal([100n, 200n], 50n), 350n);
  const s = costSummary({
    approvedBudgetKobo: 350n, contingencyKobo: 50n,
    packages: [{ id: "a", budgetKobo: 100n }, { id: "b", budgetKobo: 200n }],
    commitments: [{ workPackageId: "a", contractKobo: 120n }, { workPackageId: "b", contractKobo: 150n }, { workPackageId: null, contractKobo: 10n }],
    invoices: [{ workPackageId: "a", amountKobo: 60n, paid: true }, { workPackageId: "a", amountKobo: 20n, paid: false }, { workPackageId: "b", amountKobo: 40n, paid: false }],
    forecasts: [{ workPackageId: "b", etcKobo: 130n }],
  });
  const a = s.packages.find((p) => p.id === "a")!;
  const b = s.packages.find((p) => p.id === "b")!;
  assert.equal(a.forecastKobo, 120n); // no estimate: larger of committed 120 and invoiced 80
  assert.equal(a.overrunKobo, 20n);
  assert.equal(b.forecastKobo, 170n); // invoiced 40 + estimate to complete 130
  assert.equal(b.overrunKobo, 0n);
  assert.equal(s.committedKobo, 280n);
  assert.equal(s.invoicedKobo, 120n);
  assert.equal(s.paidKobo, 60n);
  assert.equal(s.forecastKobo, 300n); // 120 + 170 + 10 not in a package
  assert.equal(s.uncommittedKobo, 70n);
  assert.equal(s.varianceKobo, 50n);
  assert.equal(s.overrunKobo, 30n); // 20 on a, 10 on the general bucket
  assert.equal(s.contingencyLeftKobo, 20n);
  assert.equal(s.overBudget, false);
  const over = costSummary({ approvedBudgetKobo: 100n, contingencyKobo: 0n, packages: [{ id: "a", budgetKobo: 100n }], commitments: [], invoices: [], forecasts: [{ workPackageId: "a", etcKobo: 150n }] });
  assert.equal(over.overBudget, true);
  assert.equal(over.varianceKobo, -50n);
});

test("budget-based draft figure before approval", () => {
  const s = costSummary({ approvedBudgetKobo: null, contingencyKobo: 10n, packages: [{ id: "a", budgetKobo: 90n }], commitments: [], invoices: [], forecasts: [] });
  assert.equal(s.budgetKobo, 100n);
});

test("commitments and invoices are held within the budget and the contract sum", () => {
  assert.match(commitmentProblem({ approvedBudgetKobo: null, committedKobo: 0n, amountKobo: 1n }) ?? "", /not been approved/);
  assert.match(commitmentProblem({ approvedBudgetKobo: 100n, committedKobo: 90n, amountKobo: 11n }) ?? "", /more than the approved budget/);
  assert.equal(commitmentProblem({ approvedBudgetKobo: 100n, committedKobo: 90n, amountKobo: 10n }), null);
  assert.match(commitmentProblem({ approvedBudgetKobo: 100n, committedKobo: 0n, amountKobo: 0n }) ?? "", /more than zero/);
  assert.match(invoiceProblem({ contractKobo: 100n, invoicedSoFarKobo: 70n, amountKobo: 31n }) ?? "", /contract sum/);
  assert.equal(invoiceProblem({ contractKobo: 100n, invoicedSoFarKobo: 70n, amountKobo: 30n }), null);
});

test("a project cannot start without an approved budget, a manager and work packages", () => {
  assert.equal(activationProblems({ budgetApproved: true, hasManager: true, packageCount: 2 }).length, 0);
  assert.equal(activationProblems({ budgetApproved: false, hasManager: false, packageCount: 0 }).length, 3);
});

test("schedule warnings and extensions", () => {
  const p = { plannedStart: d("2026-01-01"), plannedEnd: d("2026-06-30") };
  assert.equal(scheduleWarnings(p, { plannedStart: d("2026-02-01"), plannedEnd: d("2026-03-01") }).length, 0);
  assert.equal(scheduleWarnings(p, { plannedStart: d("2025-12-01"), plannedEnd: d("2026-03-01") }).length, 1);
  assert.equal(scheduleWarnings(p, { plannedStart: d("2026-02-01"), plannedEnd: d("2026-07-01") }).length, 1);
  assert.equal(extendedEnd(d("2026-06-30"), 5).toISOString().slice(0, 10), "2026-07-05");
});

import { deliveryProblem, procurementState, qualityBlocksCompletion, riskLevel, riskProblem, riskReviewOverdue, riskScore } from "../../src/lib/project-rules";

test("risk scores, levels and the rule for high risks", () => {
  assert.equal(riskScore(3, 4), 12);
  assert.throws(() => riskScore(0, 3));
  assert.throws(() => riskScore(3, 6));
  assert.throws(() => riskScore(2.5, 3));
  assert.equal(riskLevel(15), "HIGH");
  assert.equal(riskLevel(14), "MEDIUM");
  assert.equal(riskLevel(8), "MEDIUM");
  assert.equal(riskLevel(7), "LOW");
  assert.match(riskProblem({ likelihood: 5, impact: 4, ownerId: null, mitigation: "Cover the roof" }) ?? "", /owner/);
  assert.match(riskProblem({ likelihood: 5, impact: 4, ownerId: "m1", mitigation: "" }) ?? "", /plan/);
  assert.equal(riskProblem({ likelihood: 5, impact: 4, ownerId: "m1", mitigation: "Cover the roof" }), null);
  assert.equal(riskProblem({ likelihood: 2, impact: 2, ownerId: null, mitigation: "" }), null);
  assert.equal(riskReviewOverdue({ status: "OPEN", reviewOn: d("2026-01-01") }, d("2026-01-02")), true);
  assert.equal(riskReviewOverdue({ status: "CLOSED", reviewOn: d("2026-01-01") }, d("2026-01-02")), false);
  assert.equal(riskReviewOverdue({ status: "OPEN", reviewOn: null }, d("2026-01-02")), false);
});

test("procurement state and deliveries", () => {
  const today = d("2026-03-10");
  assert.equal(procurementState({ status: "REQUIRED", requiredBy: d("2026-03-09") }, today), "LATE");
  assert.equal(procurementState({ status: "ORDERED", requiredBy: d("2026-03-17") }, today), "DUE_SOON");
  assert.equal(procurementState({ status: "ORDERED", requiredBy: d("2026-03-18") }, today), "OK");
  assert.equal(procurementState({ status: "DELIVERED", requiredBy: d("2026-01-01") }, today), "DONE");
  assert.equal(procurementState({ status: "CANCELLED", requiredBy: d("2026-01-01") }, today), "CANCELLED");
  assert.equal(deliveryProblem({ quantity: 10, deliveredSoFar: 4, receiving: 6 }), null);
  assert.match(deliveryProblem({ quantity: 10, deliveredSoFar: 4, receiving: 7 }) ?? "", /Only 6/);
  assert.match(deliveryProblem({ quantity: 10, deliveredSoFar: 0, receiving: 0 }) ?? "", /whole number/);
});

test("open quality checks block completion", () => {
  assert.equal(qualityBlocksCompletion([{ result: "PASSED" }, { result: "WAIVED" }]), 0);
  assert.equal(qualityBlocksCompletion([{ result: "PASSED" }, { result: "PENDING" }, { result: "FAILED" }]), 2);
});

import { completionProblems, defectState, defectsOpenForRaising, defectsPeriodEnd, handoverProblems, warrantyProblem, warrantyState } from "../../src/lib/project-rules";

const dt = (s: string) => new Date(`${s}T00:00:00Z`);

test("the defects period ends the same day months later, clamped to month end", () => {
  assert.equal(defectsPeriodEnd(dt("2026-03-15"), 12).toISOString().slice(0, 10), "2027-03-15");
  assert.equal(defectsPeriodEnd(dt("2026-01-31"), 1).toISOString().slice(0, 10), "2026-02-28");
  assert.equal(defectsPeriodEnd(dt("2024-01-31"), 1).toISOString().slice(0, 10), "2024-02-29");
  assert.equal(defectsPeriodEnd(dt("2026-11-30"), 3).toISOString().slice(0, 10), "2027-02-28");
  assert.equal(defectsPeriodEnd(dt("2026-03-15"), 0).toISOString().slice(0, 10), "2026-03-15");
  assert.throws(() => defectsPeriodEnd(dt("2026-03-15"), 61), /0 to 60/);
  assert.throws(() => defectsPeriodEnd(dt("2026-03-15"), 1.5), /0 to 60/);
});

test("completion is blocked by unfinished work, critical defects and undecided requests, and warns about unpaid invoices", () => {
  const ok = { packages: [{ status: "DONE" }], openCriticalDefects: 0, pendingDecisions: 0, pendingInvoices: 0, unpaidApprovedInvoices: 0 };
  assert.deepEqual(completionProblems(ok), { blocks: [], warnings: [] });
  assert.match(completionProblems({ ...ok, packages: [] }).blocks[0], /no work packages/);
  assert.match(completionProblems({ ...ok, packages: [{ status: "DONE" }, { status: "IN_PROGRESS" }] }).blocks[0], /1 work package is not done/);
  assert.match(completionProblems({ ...ok, openCriticalDefects: 2 }).blocks[0], /2 critical defects are not yet verified/);
  assert.match(completionProblems({ ...ok, pendingDecisions: 1 }).blocks[0], /1 request is still waiting/);
  assert.match(completionProblems({ ...ok, pendingInvoices: 3 }).blocks[0], /3 invoices have not been decided/);
  const w = completionProblems({ ...ok, unpaidApprovedInvoices: 1 });
  assert.equal(w.blocks.length, 0);
  assert.match(w.warnings[0], /unpaid/);
});

test("defects can be raised while running and until the defects period ends", () => {
  const today = dt("2026-06-01");
  assert.equal(defectsOpenForRaising({ status: "ACTIVE", defectsPeriodEnd: null }, today), true);
  assert.equal(defectsOpenForRaising({ status: "PLANNING", defectsPeriodEnd: null }, today), false);
  assert.equal(defectsOpenForRaising({ status: "COMPLETED", defectsPeriodEnd: dt("2026-06-01") }, today), true);
  assert.equal(defectsOpenForRaising({ status: "COMPLETED", defectsPeriodEnd: dt("2026-05-31") }, today), false);
  assert.equal(defectsOpenForRaising({ status: "CANCELLED", defectsPeriodEnd: null }, today), false);
});

test("defect and warranty states", () => {
  const today = dt("2026-06-01");
  assert.equal(defectState({ status: "OPEN", dueOn: dt("2026-05-31") }, today), "OVERDUE");
  assert.equal(defectState({ status: "OPEN", dueOn: dt("2026-06-01") }, today), "OPEN");
  assert.equal(defectState({ status: "FIXED", dueOn: dt("2026-01-01") }, today), "AWAITING_VERIFICATION");
  assert.equal(defectState({ status: "VERIFIED", dueOn: null }, today), "CLOSED");
  assert.equal(warrantyState({ startsOn: dt("2026-01-01"), endsOn: dt("2026-12-31") }, today), "ACTIVE");
  assert.equal(warrantyState({ startsOn: dt("2026-01-01"), endsOn: dt("2026-07-31") }, today), "EXPIRING");
  assert.equal(warrantyState({ startsOn: dt("2026-01-01"), endsOn: dt("2026-05-31") }, today), "EXPIRED");
  assert.equal(warrantyState({ startsOn: dt("2026-07-01"), endsOn: dt("2027-05-31") }, today), "NOT_STARTED");
  assert.match(warrantyProblem({ startsOn: dt("2026-02-01"), endsOn: dt("2026-01-01"), provider: "Roofers" }) ?? "", /before it starts/);
  assert.match(warrantyProblem({ startsOn: dt("2026-01-01"), endsOn: dt("2026-02-01"), provider: " " }) ?? "", /who gives/);
  assert.equal(warrantyProblem({ startsOn: dt("2026-01-01"), endsOn: dt("2026-01-01"), provider: "Roofers" }), null);
});

test("handover needs a complete checklist, no serious open defects and a named recipient", () => {
  assert.deepEqual(handoverProblems({ items: [{ done: true }], openSeriousDefects: 0, handedTo: "Owner" }), []);
  const p = handoverProblems({ items: [{ done: true }, { done: false }], openSeriousDefects: 1, handedTo: "" });
  assert.equal(p.length, 3);
  assert.match(p[0], /1 handover checklist item is not ticked/);
  assert.match(p[1], /1 high or critical defect is not yet verified/);
});
