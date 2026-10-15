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
