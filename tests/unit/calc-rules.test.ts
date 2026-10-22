import { test } from "node:test";
import assert from "node:assert/strict";
import { affordability, compareRefs, development, investment, irr, loanPayment, maintenanceBudget, moveInCost, portfolioIncome, purchaseCost, rentalYield } from "../../src/lib/calc-rules";

const near = (a: number, b: number, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${a} is not near ${b}`);

test("rent affordability and move-in costs", () => {
  const a = affordability({ monthlyIncome: 500_000, sharePct: 30, yearsUpfront: 1, feesPct: 20 });
  assert.equal(a.maxYearlyRent, 1_800_000);
  near(a.upfrontNeeded, 2_160_000);
  const m = moveInCost({ yearlyRent: 3_000_000, yearsUpfront: 2, serviceCharge: 500_000, cautionPct: 10, agencyPct: 10, legalPct: 10 });
  assert.equal(m.rent, 6_000_000);
  assert.equal(m.service, 1_000_000);
  assert.equal(m.total, 6_000_000 + 1_000_000 + 300_000 + 300_000 + 300_000);
  assert.equal(m.refundable, 300_000);
});

test("purchase costs and yields", () => {
  const p = purchaseCost({ price: 100_000_000, agencyPct: 5, legalPct: 5, consentPct: 3, survey: 500_000, other: 0 });
  assert.equal(p.total, 113_500_000);
  near(p.extrasPct, 13.5, 0.001);
  const y = rentalYield({ price: 100_000_000, buyingCosts: 13_500_000, yearlyRent: 8_000_000, vacancyMonths: 1, serviceCharge: 400_000, maintenancePct: 1, managementPct: 10, insurance: 100_000 });
  near(y.gross, 8, 0.001);
  near(y.collected, 8_000_000 * 11 / 12);
  near(y.netIncome, 8_000_000 * 11 / 12 - (400_000 + 1_000_000 + 8_000_000 * 11 / 12 * 0.1 + 100_000));
  assert.ok(y.net < y.gross);
  assert.equal(rentalYield({ price: 0, buyingCosts: 0, yearlyRent: 0, vacancyMonths: 0, serviceCharge: 0, maintenancePct: 0, managementPct: 0, insurance: 0 }).gross, 0);
});

test("income, maintenance and loans", () => {
  const inc = portfolioIncome({ units: 10, rentPerUnit: 1_000_000, occupancyPct: 80, badDebtPct: 5, otherIncome: 0, operatingCosts: 1_000_000 });
  assert.equal(inc.potential, 10_000_000);
  near(inc.vacancyLoss, 2_000_000);
  near(inc.badDebt, 400_000);
  near(inc.noi, 7_600_000 - 1_000_000);
  const m = maintenanceBudget({ value: 50_000_000, pctOfValue: 1, area: 0, ratePerSqm: 0, contingencyPct: 10 });
  assert.equal(m.basis, "value");
  near(m.yearly, 550_000);
  assert.equal(maintenanceBudget({ value: 50_000_000, pctOfValue: 1, area: 200, ratePerSqm: 2_000, contingencyPct: 0 }).yearly, 400_000);
  const l = loanPayment({ amount: 10_000_000, ratePct: 12, years: 1 });
  near(l.monthly, 888_487.88, 0.01);
  assert.equal(loanPayment({ amount: 1_200_000, ratePct: 0, years: 1 }).monthly, 100_000);
  assert.equal(loanPayment({ amount: 0, ratePct: 10, years: 5 }).monthly, 0);
});

test("investment and development appraisals", () => {
  near(irr([-100, 110])!, 10, 0.001);
  assert.equal(irr([100, 100]), null);
  const inv = investment({ price: 100, buyingCosts: 0, yearlyRent: 10, rentGrowthPct: 0, costsPct: 0, vacancyPct: 0, appreciationPct: 0, years: 2, sellingCostsPct: 0 });
  assert.deepEqual(inv.flows, [-100, 10, 110]);
  near(inv.irr!, 10, 0.001);
  assert.equal(inv.profit, 20);
  const d = development({ land: 50, floorArea: 1000, buildCostPerSqm: 0.2, feesPct: 10, contingencyPct: 5, financePct: 10, efficiencyPct: 80, salePricePerSqm: 0.5, sellingCostsPct: 5 });
  near(d.build, 200, 1e-9);
  near(d.totalCost, (50 + 200 + 20 + 10) * 1.1, 1e-9);
  near(d.gdv, 400, 1e-9);
  near(d.profit, 400 - 20 - 308, 1e-9);
});

test("compare references are cleaned and capped", () => {
  assert.deepEqual(compareRefs("prop-abc123, PROP-ABC123,PROP-ZZZZZZ,bad,PROP-111111,PROP-222222,PROP-333333"), ["PROP-ABC123", "PROP-ZZZZZZ", "PROP-111111", "PROP-222222"]);
  assert.deepEqual(compareRefs(undefined), []);
});
