"use client";
import { useMemo, useState } from "react";
import { CALCULATORS, affordability, development, investment, loanPayment, maintenanceBudget, moveInCost, portfolioIncome, purchaseCost, rentalYield, type CalcId } from "@/lib/calc-rules";

type Field = { key: string; label: string; unit: "₦" | "%" | "years" | "months" | "m²" | "₦/m²" | "units"; def: number; hint?: string };
type Row = { label: string; value: string; strong?: boolean };
const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;
const per = (n: number) => `${n.toLocaleString("en-NG", { maximumFractionDigits: 1 })}%`;

const SPECS: Record<CalcId, { intro: string; fields: Field[]; run: (v: Record<string, number>) => Row[] }> = {
  afford: {
    intro: "How much yearly rent fits your income, and how much cash you need to move in.",
    fields: [
      { key: "monthlyIncome", label: "Take-home pay per month", unit: "₦", def: 500_000 },
      { key: "sharePct", label: "Share of income for rent", unit: "%", def: 30, hint: "A common guide is up to a third." },
      { key: "yearsUpfront", label: "Years of rent paid upfront", unit: "years", def: 1 },
      { key: "feesPct", label: "Agency, legal and caution together", unit: "%", def: 30, hint: "Often 10% + 10% + 10% of a year's rent." },
    ],
    run: (v) => { const r = affordability({ monthlyIncome: v.monthlyIncome, sharePct: v.sharePct, yearsUpfront: v.yearsUpfront, feesPct: v.feesPct });
      return [{ label: "Rent you can afford per year", value: naira(r.maxYearlyRent), strong: true }, { label: "That is per month", value: naira(r.maxMonthlyRent) }, { label: "Cash needed to move in", value: naira(r.upfrontNeeded), strong: true }, { label: "Months of pay that takes", value: r.monthsOfIncome.toFixed(1) }]; },
  },
  movein: {
    intro: "Everything you pay before you get the keys.",
    fields: [
      { key: "yearlyRent", label: "Rent per year", unit: "₦", def: 3_000_000 }, { key: "yearsUpfront", label: "Years paid upfront", unit: "years", def: 1 },
      { key: "serviceCharge", label: "Service charge per year", unit: "₦", def: 300_000 }, { key: "cautionPct", label: "Caution deposit", unit: "%", def: 10, hint: "Of a year's rent. Usually refundable." },
      { key: "agencyPct", label: "Agency fee", unit: "%", def: 10 }, { key: "legalPct", label: "Legal fee", unit: "%", def: 10 },
    ],
    run: (v) => { const r = moveInCost({ yearlyRent: v.yearlyRent, yearsUpfront: v.yearsUpfront, serviceCharge: v.serviceCharge, cautionPct: v.cautionPct, agencyPct: v.agencyPct, legalPct: v.legalPct });
      return [{ label: "Rent", value: naira(r.rent) }, { label: "Service charge", value: naira(r.service) }, { label: "Caution deposit (refundable)", value: naira(r.caution) }, { label: "Agency fee", value: naira(r.agency) }, { label: "Legal fee", value: naira(r.legal) }, { label: "Total to move in", value: naira(r.total), strong: true }, { label: "Running cost per year after that", value: naira(r.yearlyRunningCost) }]; },
  },
  purchase: {
    intro: "The real cost of buying, beyond the asking price.",
    fields: [
      { key: "price", label: "Price", unit: "₦", def: 100_000_000 }, { key: "agencyPct", label: "Agency fee", unit: "%", def: 5 }, { key: "legalPct", label: "Legal fee", unit: "%", def: 5 },
      { key: "consentPct", label: "Consent, stamp duty and registration", unit: "%", def: 3, hint: "Varies by state and title. Ask your lawyer." },
      { key: "survey", label: "Survey and searches", unit: "₦", def: 500_000 }, { key: "other", label: "Other costs (verification, repairs)", unit: "₦", def: 0 },
    ],
    run: (v) => { const r = purchaseCost({ price: v.price, agencyPct: v.agencyPct, legalPct: v.legalPct, consentPct: v.consentPct, survey: v.survey, other: v.other });
      return [{ label: "Agency", value: naira(r.agency) }, { label: "Legal", value: naira(r.legal) }, { label: "Consent and registration", value: naira(r.consent) }, { label: "Survey and other", value: naira(r.survey + r.other) }, { label: "Costs on top of the price", value: `${naira(r.extras)} (${per(r.extrasPct)})` }, { label: "Total cost", value: naira(r.total), strong: true }]; },
  },
  yield: {
    intro: "What a property earns each year compared with what it costs.",
    fields: [
      { key: "price", label: "Price", unit: "₦", def: 100_000_000 }, { key: "buyingCosts", label: "Buying costs", unit: "₦", def: 13_000_000 },
      { key: "yearlyRent", label: "Rent per year", unit: "₦", def: 7_000_000 }, { key: "vacancyMonths", label: "Empty months per year", unit: "months", def: 1 },
      { key: "serviceCharge", label: "Service charge you pay", unit: "₦", def: 0 }, { key: "maintenancePct", label: "Maintenance", unit: "%", def: 1, hint: "Of the price, per year." },
      { key: "managementPct", label: "Management fee", unit: "%", def: 10, hint: "Of rent collected." }, { key: "insurance", label: "Insurance per year", unit: "₦", def: 100_000 },
    ],
    run: (v) => { const r = rentalYield({ price: v.price, buyingCosts: v.buyingCosts, yearlyRent: v.yearlyRent, vacancyMonths: v.vacancyMonths, serviceCharge: v.serviceCharge, maintenancePct: v.maintenancePct, managementPct: v.managementPct, insurance: v.insurance });
      return [{ label: "Gross yield", value: per(r.gross), strong: true }, { label: "Rent collected", value: naira(r.collected) }, { label: "Yearly costs", value: naira(r.costs) }, { label: "Net income", value: naira(r.netIncome) }, { label: "Net yield (on all money put in)", value: per(r.net), strong: true }, { label: "Years to earn back what you put in", value: r.paybackYears ? r.paybackYears.toFixed(1) : "Never at these figures" }]; },
  },
  income: {
    intro: "For a building or portfolio: what empty units and unpaid rent cost you.",
    fields: [
      { key: "units", label: "Units", unit: "units", def: 12 }, { key: "rentPerUnit", label: "Rent per unit per year", unit: "₦", def: 2_500_000 },
      { key: "occupancyPct", label: "Occupancy", unit: "%", def: 85 }, { key: "badDebtPct", label: "Rent not collected", unit: "%", def: 5 },
      { key: "otherIncome", label: "Other income per year", unit: "₦", def: 0, hint: "Parking, signage, service charge surplus." }, { key: "operatingCosts", label: "Operating costs per year", unit: "₦", def: 4_000_000 },
    ],
    run: (v) => { const r = portfolioIncome({ units: v.units, rentPerUnit: v.rentPerUnit, occupancyPct: v.occupancyPct, badDebtPct: v.badDebtPct, otherIncome: v.otherIncome, operatingCosts: v.operatingCosts });
      return [{ label: "Rent if every unit were let", value: naira(r.potential) }, { label: "Lost to empty units", value: naira(r.vacancyLoss) }, { label: "Lost to unpaid rent", value: naira(r.badDebt) }, { label: "Effective income", value: naira(r.effective) }, { label: "Net operating income", value: naira(r.noi), strong: true }, { label: "Each empty unit costs per year", value: naira(r.eachVacantUnitCosts) }, { label: "Costs as a share of income", value: per(r.operatingRatio) }]; },
  },
  maintenance: {
    intro: "A yearly budget for keeping the property in good order. Enter an area and rate to use those instead of a share of value.",
    fields: [
      { key: "value", label: "Property value", unit: "₦", def: 80_000_000 }, { key: "pctOfValue", label: "Share of value per year", unit: "%", def: 1 },
      { key: "area", label: "Floor area (optional)", unit: "m²", def: 0 }, { key: "ratePerSqm", label: "Rate per m² per year (optional)", unit: "₦/m²", def: 0 },
      { key: "contingencyPct", label: "Contingency", unit: "%", def: 10 },
    ],
    run: (v) => { const r = maintenanceBudget({ value: v.value, pctOfValue: v.pctOfValue, area: v.area, ratePerSqm: v.ratePerSqm, contingencyPct: v.contingencyPct });
      return [{ label: "Based on", value: r.basis === "area" ? "Area and rate" : "Share of value" }, { label: "Planned work", value: naira(r.base) }, { label: "Contingency", value: naira(r.contingency) }, { label: "Budget per year", value: naira(r.yearly), strong: true }, { label: "Set aside per month", value: naira(r.monthly) }]; },
  },
  invest: {
    intro: "Buy, let for some years, then sell. Change the growth figures to see a cautious and a hopeful case.",
    fields: [
      { key: "price", label: "Price", unit: "₦", def: 100_000_000 }, { key: "buyingCosts", label: "Buying costs", unit: "₦", def: 13_000_000 },
      { key: "yearlyRent", label: "Rent in year one", unit: "₦", def: 7_000_000 }, { key: "rentGrowthPct", label: "Rent growth per year", unit: "%", def: 10 },
      { key: "costsPct", label: "Running costs", unit: "%", def: 20, hint: "Of rent collected." }, { key: "vacancyPct", label: "Time empty", unit: "%", def: 8 },
      { key: "appreciationPct", label: "Value growth per year", unit: "%", def: 8 }, { key: "years", label: "Years held", unit: "years", def: 5 },
      { key: "sellingCostsPct", label: "Selling costs", unit: "%", def: 5 },
    ],
    run: (v) => { const r = investment({ price: v.price, buyingCosts: v.buyingCosts, yearlyRent: v.yearlyRent, rentGrowthPct: v.rentGrowthPct, costsPct: v.costsPct, vacancyPct: v.vacancyPct, appreciationPct: v.appreciationPct, years: v.years, sellingCostsPct: v.sellingCostsPct });
      return [{ label: "Money put in", value: naira(r.outlay) }, { label: "Estimated sale value", value: naira(r.saleValue) }, { label: "Profit over the period", value: naira(r.profit), strong: true }, { label: "Money back for each ₦1 put in", value: `₦${r.multiple.toFixed(2)}` }, { label: "Yearly return (IRR)", value: r.irr === null ? "Cannot be worked out" : per(r.irr), strong: true }]; },
  },
  develop: {
    intro: "A first look at whether a development pays: cost to build against what it might sell for.",
    fields: [
      { key: "land", label: "Land cost", unit: "₦", def: 150_000_000 }, { key: "floorArea", label: "Total floor area", unit: "m²", def: 1_200 },
      { key: "buildCostPerSqm", label: "Build cost per m²", unit: "₦/m²", def: 350_000 }, { key: "feesPct", label: "Professional fees", unit: "%", def: 10, hint: "Of build cost." },
      { key: "contingencyPct", label: "Contingency", unit: "%", def: 10, hint: "Of build cost." }, { key: "financePct", label: "Finance cost", unit: "%", def: 8, hint: "Of total cost, over the project." },
      { key: "efficiencyPct", label: "Share of floor area you can sell", unit: "%", def: 85 }, { key: "salePricePerSqm", label: "Sale price per m²", unit: "₦/m²", def: 750_000 },
      { key: "sellingCostsPct", label: "Selling costs", unit: "%", def: 5 },
    ],
    run: (v) => { const r = development({ land: v.land, floorArea: v.floorArea, buildCostPerSqm: v.buildCostPerSqm, feesPct: v.feesPct, contingencyPct: v.contingencyPct, financePct: v.financePct, efficiencyPct: v.efficiencyPct, salePricePerSqm: v.salePricePerSqm, sellingCostsPct: v.sellingCostsPct });
      return [{ label: "Build cost", value: naira(r.build) }, { label: "Fees, contingency and finance", value: naira(r.fees + r.contingency + r.finance) }, { label: "Total cost", value: naira(r.totalCost) }, { label: "Sales value (GDV)", value: naira(r.gdv) }, { label: "Profit", value: naira(r.profit), strong: true }, { label: "Profit on cost", value: per(r.marginOnCost), strong: true }, { label: "Profit on sales value", value: per(r.marginOnGdv) }, { label: "Break-even sale price per m²", value: naira(r.breakEvenPerSqm) }]; },
  },
  loan: {
    intro: "Equal monthly repayments on a loan or mortgage.",
    fields: [{ key: "amount", label: "Amount borrowed", unit: "₦", def: 50_000_000 }, { key: "ratePct", label: "Interest rate per year", unit: "%", def: 18 }, { key: "years", label: "Term", unit: "years", def: 15 }],
    run: (v) => { const r = loanPayment({ amount: v.amount, ratePct: v.ratePct, years: v.years });
      return [{ label: "Monthly repayment", value: naira(r.monthly), strong: true }, { label: "Number of payments", value: String(r.months) }, { label: "Total repaid", value: naira(r.totalPaid) }, { label: "Total interest", value: naira(r.interest) }]; },
  },
};

const show = (n: number) => n.toLocaleString("en-NG", { maximumFractionDigits: 2 });
const parse = (s: string) => { const n = Number(s.replace(/[,\s₦]/g, "")); return Number.isFinite(n) ? n : 0; };

/** All calculators, one at a time behind tabs. Every assumption is an editable field with its default showing. */
export function Calculators({ start, preset }: { start: CalcId; preset: Record<string, number> }) {
  const [tab, setTab] = useState<CalcId>(start);
  const [vals, setVals] = useState<Record<CalcId, Record<string, string>>>(() => Object.fromEntries((Object.keys(SPECS) as CalcId[]).map((id) => [id, Object.fromEntries(SPECS[id].fields.map((f) => [f.key, show(preset[f.key] ?? f.def)]))])) as Record<CalcId, Record<string, string>>);
  const spec = SPECS[tab];
  const rows = useMemo(() => spec.run(Object.fromEntries(Object.entries(vals[tab]).map(([k, v]) => [k, parse(v)]))), [spec, vals, tab]);
  const reset = () => setVals((all) => ({ ...all, [tab]: Object.fromEntries(spec.fields.map((f) => [f.key, show(f.def)])) }));
  return (
    <div className="calc">
      <div className="calc-tabs" role="tablist" aria-label="Calculators">
        {CALCULATORS.map((c) => <button key={c.id} type="button" role="tab" id={`tab-${c.id}`} aria-selected={tab === c.id} aria-controls="calc-panel" onClick={() => setTab(c.id)}>{c.title}</button>)}
      </div>
      <div id="calc-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="calc-body">
        <form className="card stack" onSubmit={(e) => e.preventDefault()} aria-label="Assumptions">
          <h2>{CALCULATORS.find((c) => c.id === tab)!.title}</h2>
          <p className="muted">{spec.intro}</p>
          <div className="calc-fields">
            {spec.fields.map((f) => (
              <label key={f.key} className="field">{`${f.label} (${f.unit})`}
                <input inputMode="decimal" value={vals[tab][f.key]} onChange={(e) => setVals((all) => ({ ...all, [tab]: { ...all[tab], [f.key]: e.target.value } }))} />
                {f.hint ? <small>{f.hint}</small> : null}
              </label>
            ))}
          </div>
          <div className="row"><button className="btn" type="button" onClick={reset}>Back to the default figures</button></div>
        </form>
        <section className="card stack calc-out" aria-live="polite" aria-label="Results">
          <h2>Result</h2>
          <dl className="calc-rows">{rows.map((r) => <div key={r.label} className={r.strong ? "strong" : undefined}><dt>{r.label}</dt><dd>{r.value}</dd></div>)}</dl>
          <p className="small muted">An estimate from the figures you entered, not a promise of any return and not legal, tax, lending or investment advice. Costs and rules differ by state and change over time: confirm with a lawyer, valuer or lender before you commit money.</p>
        </section>
      </div>
    </div>
  );
}
