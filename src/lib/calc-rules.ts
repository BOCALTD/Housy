/**
 * Property calculators (master prompt §33). Every assumption is an input with a visible default the person can change.
 * Results are estimates, never guaranteed returns or legal, tax, lending or investment advice. Pure functions, tested on their own.
 * Amounts are naira (not kobo): these are planning estimates, not money records.
 */

const pct = (n: number) => n / 100;
const pos = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/** How much yearly rent fits a monthly income, keeping rent to a share of income. */
export function affordability(i: { monthlyIncome: number; sharePct: number; yearsUpfront: number; feesPct: number }) {
  const yearlyIncome = pos(i.monthlyIncome) * 12;
  const maxYearlyRent = yearlyIncome * pct(pos(i.sharePct));
  const upfront = maxYearlyRent * Math.max(1, pos(i.yearsUpfront)) * (1 + pct(pos(i.feesPct)));
  return { yearlyIncome, maxYearlyRent, maxMonthlyRent: maxYearlyRent / 12, upfrontNeeded: upfront, monthsOfIncome: yearlyIncome ? upfront / (yearlyIncome / 12) : 0 };
}

/** What it costs to move in: rent for the years paid upfront, service charge, caution deposit, agency and legal fees. */
export function moveInCost(i: { yearlyRent: number; yearsUpfront: number; serviceCharge: number; cautionPct: number; agencyPct: number; legalPct: number }) {
  const years = Math.max(1, pos(i.yearsUpfront));
  const rent = pos(i.yearlyRent) * years;
  const service = pos(i.serviceCharge) * years;
  const caution = pos(i.yearlyRent) * pct(pos(i.cautionPct));
  const agency = pos(i.yearlyRent) * pct(pos(i.agencyPct));
  const legal = pos(i.yearlyRent) * pct(pos(i.legalPct));
  const total = rent + service + caution + agency + legal;
  return { rent, service, caution, agency, legal, total, refundable: caution, yearlyRunningCost: pos(i.yearlyRent) + pos(i.serviceCharge) };
}

/** The full cost of buying: price plus agency, legal, consent and registration, survey and other costs. */
export function purchaseCost(i: { price: number; agencyPct: number; legalPct: number; consentPct: number; survey: number; other: number }) {
  const price = pos(i.price);
  const agency = price * pct(pos(i.agencyPct)), legal = price * pct(pos(i.legalPct)), consent = price * pct(pos(i.consentPct));
  const extras = agency + legal + consent + pos(i.survey) + pos(i.other);
  return { price, agency, legal, consent, survey: pos(i.survey), other: pos(i.other), extras, total: price + extras, extrasPct: price ? (extras / price) * 100 : 0 };
}

/** Gross and net rental yield after costs and empty months. */
export function rentalYield(i: { price: number; buyingCosts: number; yearlyRent: number; vacancyMonths: number; serviceCharge: number; maintenancePct: number; managementPct: number; insurance: number }) {
  const invested = pos(i.price) + pos(i.buyingCosts);
  const months = Math.min(12, pos(i.vacancyMonths));
  const collected = pos(i.yearlyRent) * (12 - months) / 12;
  const costs = pos(i.serviceCharge) + pos(i.price) * pct(pos(i.maintenancePct)) + collected * pct(pos(i.managementPct)) + pos(i.insurance);
  const net = collected - costs;
  return { invested, gross: pos(i.price) ? (pos(i.yearlyRent) / pos(i.price)) * 100 : 0, collected, costs, netIncome: net, net: invested ? (net / invested) * 100 : 0, paybackYears: net > 0 ? invested / net : null };
}

/** Income from a building or portfolio: potential rent, what empty units and unpaid rent cost, and net operating income. */
export function portfolioIncome(i: { units: number; rentPerUnit: number; occupancyPct: number; badDebtPct: number; otherIncome: number; operatingCosts: number }) {
  const potential = pos(i.units) * pos(i.rentPerUnit);
  const occupancy = Math.min(100, pos(i.occupancyPct));
  const vacancyLoss = potential * (1 - pct(occupancy));
  const afterVacancy = potential - vacancyLoss;
  const badDebt = afterVacancy * pct(Math.min(100, pos(i.badDebtPct)));
  const effective = afterVacancy - badDebt + pos(i.otherIncome);
  const noi = effective - pos(i.operatingCosts);
  return { potential, vacancyLoss, badDebt, effective, noi, eachVacantUnitCosts: pos(i.rentPerUnit), operatingRatio: effective ? (pos(i.operatingCosts) / effective) * 100 : 0 };
}

/** A yearly maintenance budget, from a share of the property's value or a rate per square metre (whichever is given). */
export function maintenanceBudget(i: { value: number; pctOfValue: number; area: number; ratePerSqm: number; contingencyPct: number }) {
  const byValue = pos(i.value) * pct(pos(i.pctOfValue));
  const byArea = pos(i.area) * pos(i.ratePerSqm);
  const base = byArea > 0 ? byArea : byValue;
  const contingency = base * pct(pos(i.contingencyPct));
  const yearly = base + contingency;
  return { basis: byArea > 0 ? "area" as const : "value" as const, base, contingency, yearly, monthly: yearly / 12 };
}

/** Monthly repayment of a loan (equal payments), and the total interest. */
export function loanPayment(i: { amount: number; ratePct: number; years: number }) {
  const n = Math.round(pos(i.years) * 12);
  const p = pos(i.amount);
  if (!n || !p) return { monthly: 0, totalPaid: 0, interest: 0, months: n };
  const r = pct(pos(i.ratePct)) / 12;
  const monthly = r === 0 ? p / n : (p * r) / (1 - Math.pow(1 + r, -n));
  return { monthly, totalPaid: monthly * n, interest: monthly * n - p, months: n };
}

/** Internal rate of return of yearly cash flows (first one usually negative), by bisection. Null when there is no sign change. */
export function irr(flows: number[]): number | null {
  const npv = (r: number) => flows.reduce((s, f, t) => s + f / Math.pow(1 + r, t), 0);
  let lo = -0.99, hi = 10;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let k = 0; k < 200; k++) { const mid = (lo + hi) / 2; if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid; }
  return ((lo + hi) / 2) * 100;
}

/** Buy, let and sell after some years: yearly cash flows, total return and an IRR, under the stated growth assumptions. */
export function investment(i: { price: number; buyingCosts: number; yearlyRent: number; rentGrowthPct: number; costsPct: number; vacancyPct: number; appreciationPct: number; years: number; sellingCostsPct: number }) {
  const years = Math.max(1, Math.min(50, Math.round(pos(i.years))));
  const outlay = pos(i.price) + pos(i.buyingCosts);
  const flows: number[] = [-outlay];
  const rows: { year: number; income: number; value: number }[] = [];
  for (let t = 1; t <= years; t++) {
    const rent = pos(i.yearlyRent) * Math.pow(1 + pct(i.rentGrowthPct || 0), t - 1);
    const income = rent * (1 - pct(Math.min(100, pos(i.vacancyPct)))) * (1 - pct(Math.min(100, pos(i.costsPct))));
    const value = pos(i.price) * Math.pow(1 + pct(i.appreciationPct || 0), t);
    rows.push({ year: t, income, value });
    flows.push(income + (t === years ? value * (1 - pct(pos(i.sellingCostsPct))) : 0));
  }
  const totalIn = flows.slice(1).reduce((s, f) => s + f, 0);
  return { outlay, rows, flows, profit: totalIn - outlay, multiple: outlay ? totalIn / outlay : 0, irr: irr(flows), saleValue: rows[rows.length - 1].value };
}

/** A development appraisal: what it costs to build and what it might sell for. */
export function development(i: { land: number; floorArea: number; buildCostPerSqm: number; feesPct: number; contingencyPct: number; financePct: number; efficiencyPct: number; salePricePerSqm: number; sellingCostsPct: number }) {
  const build = pos(i.floorArea) * pos(i.buildCostPerSqm);
  const fees = build * pct(pos(i.feesPct));
  const contingency = build * pct(pos(i.contingencyPct));
  const beforeFinance = pos(i.land) + build + fees + contingency;
  const finance = beforeFinance * pct(pos(i.financePct));
  const totalCost = beforeFinance + finance;
  const saleable = pos(i.floorArea) * pct(Math.min(100, pos(i.efficiencyPct)));
  const gdv = saleable * pos(i.salePricePerSqm);
  const selling = gdv * pct(pos(i.sellingCostsPct));
  const profit = gdv - selling - totalCost;
  return { build, fees, contingency, finance, totalCost, saleable, gdv, selling, profit, marginOnCost: totalCost ? (profit / totalCost) * 100 : 0, marginOnGdv: gdv ? (profit / gdv) * 100 : 0, breakEvenPerSqm: saleable ? totalCost / saleable / (1 - pct(pos(i.sellingCostsPct))) : 0 };
}

export const CALCULATORS = [
  { id: "afford", title: "Rent affordability" },
  { id: "movein", title: "Rent and move-in costs" },
  { id: "purchase", title: "Purchase costs" },
  { id: "yield", title: "Rental yield" },
  { id: "income", title: "Income and vacancy" },
  { id: "maintenance", title: "Maintenance budget" },
  { id: "invest", title: "Investment scenario" },
  { id: "develop", title: "Development appraisal" },
  { id: "loan", title: "Loan or mortgage" },
] as const;
export type CalcId = (typeof CALCULATORS)[number]["id"];

export const MAX_COMPARE = 4;
/** References to compare, from the address: unique, well-formed, at most four. */
export function compareRefs(raw: string | undefined) {
  return [...new Set((raw ?? "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{2,5}-[A-Z0-9]{4,10}$/.test(s)))].slice(0, MAX_COMPARE);
}
