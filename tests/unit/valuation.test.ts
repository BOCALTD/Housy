import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDateOnly } from "../../src/lib/dates";
import {
  costApproach, deviationBps, divRound, formatArea, formatPercent, incomeCapitalisation, parseAreaSqm100, parsePercentToBps,
  reportApprovalProblem, reportReadiness, salesComparison, type ReadinessInput,
} from "../../src/lib/valuation-rules";

test("rounding, percentages and areas are exact", () => {
  assert.equal(divRound(5n, 2n), 3n);
  assert.equal(divRound(-5n, 2n), -3n);
  assert.equal(divRound(4n, 3n), 1n);
  assert.equal(parsePercentToBps("12.5"), 1250);
  assert.equal(parsePercentToBps("7%"), 700);
  assert.equal(parsePercentToBps("0.05"), 5);
  assert.equal(parsePercentToBps("-10"), -1000);
  assert.throws(() => parsePercentToBps("abc"));
  assert.equal(parseAreaSqm100("120.5"), 12050);
  assert.equal(parseAreaSqm100("1,200"), 120000);
  assert.throws(() => parseAreaSqm100("0"));
  assert.equal(formatPercent(1250), "12.5%");
  assert.equal(formatPercent(800), "8%");
  assert.equal(formatArea(12050), "120.5 m²");
});

test("sales comparison: adjusted price per square metre, weighted, times the subject area", () => {
  const r = salesComparison({
    subjectAreaSqm100: 18000,
    comparables: [
      { priceKobo: 5_000_000_000n, areaSqm100: 20000, adjustmentBps: 1000, weightBps: 10000 }, // 250,000 +10% = 275,000 per m2
      { priceKobo: 6_000_000_000n, areaSqm100: 25000, adjustmentBps: 0, weightBps: 10000 }, // 240,000 per m2
    ],
  });
  assert.equal(r.valueKobo, 4_635_000_000n); // 257,500 per m2 x 180 m2 = 46,350,000 naira
  assert.ok(r.warnings.some((w) => w.includes("fewer than 3")));
});

test("sales comparison respects weights and rejects unusable evidence", () => {
  const base = { priceKobo: 5_000_000_000n, areaSqm100: 20000, adjustmentBps: 0 };
  const r = salesComparison({ subjectAreaSqm100: 10000, comparables: [{ ...base, weightBps: 0 }, { ...base, priceKobo: 6_000_000_000n, weightBps: 10000 }] });
  assert.equal(r.valueKobo, 3_000_000_000n); // only the second counts: 300,000 per m2 x 100 m2
  assert.throws(() => salesComparison({ subjectAreaSqm100: 10000, comparables: [] }));
  assert.throws(() => salesComparison({ subjectAreaSqm100: 0, comparables: [{ ...base, weightBps: 1 }] }));
  assert.throws(() => salesComparison({ subjectAreaSqm100: 100, comparables: [{ ...base, weightBps: 0 }] }), /carry weight/);
  assert.throws(() => salesComparison({ subjectAreaSqm100: 100, comparables: [{ ...base, adjustmentBps: 6000, weightBps: 1 }] }), /between -50% and 50%/);
  const big = salesComparison({ subjectAreaSqm100: 100, comparables: [{ ...base, adjustmentBps: 3000, weightBps: 1 }] });
  assert.ok(big.warnings.some((w) => w.includes("more than 25%")));
});

test("income capitalisation", () => {
  const r = incomeCapitalisation({ grossRentKobo: 1_200_000_000n, vacancyBps: 1000, operatingCostsKobo: 108_000_000n, capRateBps: 800 });
  assert.equal(r.valueKobo, 12_150_000_000n); // NOI 9,720,000 / 8%
  assert.throws(() => incomeCapitalisation({ grossRentKobo: 100n, vacancyBps: 0, operatingCostsKobo: 100n, capRateBps: 800 }), /not positive/);
  assert.throws(() => incomeCapitalisation({ grossRentKobo: 100n, vacancyBps: 0, operatingCostsKobo: 0n, capRateBps: 50 }));
  assert.ok(incomeCapitalisation({ grossRentKobo: 1_000_000n, vacancyBps: 0, operatingCostsKobo: 0n, capRateBps: 800 }).warnings.length === 1);
});

test("depreciated replacement cost", () => {
  const r = costApproach({ landValueKobo: 2_000_000_000n, costPerSqmKobo: 30_000_000n, buildingAreaSqm100: 15000, depreciationBps: 2000 });
  assert.equal(r.valueKobo, 5_600_000_000n); // land 20m + (45m less 20%) = 56m naira
  assert.throws(() => costApproach({ landValueKobo: 0n, costPerSqmKobo: 0n, buildingAreaSqm100: 1, depreciationBps: 0 }));
  assert.throws(() => costApproach({ landValueKobo: 0n, costPerSqmKobo: 1n, buildingAreaSqm100: 1, depreciationBps: 10001 }));
});

test("deviation from the worksheets", () => {
  assert.equal(deviationBps([100n, 100n], 112n), 1200);
  assert.equal(deviationBps([100n, 200n], 150n), 0);
  assert.equal(deviationBps([], 5n), 0);
});

const ready: ReadinessInput = {
  premise: "STANDARD", valuationDate: parseDateOnly("2026-10-01"), today: parseDateOnly("2026-10-15"),
  professionalName: "A. Valuer", professionalBody: "Body", registrationNo: "R-1", assetDescription: "Three-bedroom house",
  entries: [{ kind: "LIMITATION" }], worksheets: [{ method: "SALES_COMPARISON", resultKobo: 100n, comparableCount: 3 }, { method: "COST_APPROACH", resultKobo: 104n, comparableCount: 0 }],
  concludedValueKobo: 102n, reconciliationNote: "", summary: "s", conclusion: "c",
};

test("a complete report is ready, with no blockers", () => {
  assert.deepEqual(reportReadiness(ready).blockers, []);
});

test("each missing piece of evidence blocks the report", () => {
  const blockers = (over: Partial<ReadinessInput>) => reportReadiness({ ...ready, ...over }).blockers.join(" | ");
  assert.match(blockers({ valuationDate: null }), /valuation date/);
  assert.match(blockers({ valuationDate: parseDateOnly("2026-12-01") }), /future/);
  assert.match(blockers({ professionalBody: "" }), /registration number/);
  assert.match(blockers({ worksheets: [] }), /at least one valuation worksheet/);
  assert.match(blockers({ premise: "GOING_CONCERN" }), /going-concern/);
  assert.match(blockers({ premise: "GONE_CONCERN" }), /gone-concern/);
  assert.equal(blockers({ premise: "GONE_CONCERN", entries: [{ kind: "LIMITATION" }, { kind: "PREMISE" }] }), "");
  assert.match(blockers({ entries: [] }), /limitation/);
  assert.match(blockers({ concludedValueKobo: 130n }), /Explain the difference/);
  assert.equal(blockers({ concludedValueKobo: 130n, reconciliationNote: "Weighted to the sales evidence" }), "");
  assert.match(blockers({ concludedValueKobo: null }), /concluded value/);
  assert.match(blockers({ summary: "" }), /summary/);
});

test("approval needs a second person, and AI-assisted reports need the approver's own review", () => {
  assert.match(reportApprovalProblem({ authorId: "a", approverId: "a", aiAssisted: false, confirmedReviewed: true }) ?? "", /different person/);
  assert.equal(reportApprovalProblem({ authorId: "a", approverId: "b", aiAssisted: false, confirmedReviewed: false }), null);
  assert.match(reportApprovalProblem({ authorId: "a", approverId: "b", aiAssisted: true, confirmedReviewed: false }) ?? "", /AI assistance/);
  assert.equal(reportApprovalProblem({ authorId: "a", approverId: "b", aiAssisted: true, confirmedReviewed: true }), null);
});
