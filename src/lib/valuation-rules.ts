// Valuation arithmetic and report-readiness rules (master prompt Phase 7). Pure functions: no database, no
// floating point. Money is BigInt kobo, rates are basis points (1% = 100) and areas are hundredths of a
// square metre, so every figure is exact and the same inputs always give the same answer.
// These rules support a professional's judgement. They never produce an opinion of value on their own,
// and nothing here approves a report: approval is a separate step by a second person.

export const PURPOSES = ["SALE", "PURCHASE", "MORTGAGE_SECURITY", "INSURANCE", "FINANCIAL_REPORTING", "TAXATION", "LITIGATION", "OTHER"] as const;
export const BASES = ["MARKET_VALUE", "MARKET_RENT", "REINSTATEMENT_COST", "FORCED_SALE_VALUE", "OTHER"] as const;
export const PREMISES = ["STANDARD", "GOING_CONCERN", "GONE_CONCERN"] as const;
export const METHODS = ["SALES_COMPARISON", "INCOME_CAPITALISATION", "COST_APPROACH"] as const;
export const EVIDENCE_KINDS = ["SALE", "LETTING", "LISTING", "OFFER", "OTHER"] as const;
export const ENTRY_KINDS = ["PREMISE", "ASSUMPTION", "SPECIAL_ASSUMPTION", "LIMITATION"] as const;

export type Premise = (typeof PREMISES)[number];
export type Method = (typeof METHODS)[number];
export type EntryKind = (typeof ENTRY_KINDS)[number];

export const METHOD_LABEL: Record<Method, string> = {
  SALES_COMPARISON: "Sales comparison",
  INCOME_CAPITALISATION: "Income capitalisation",
  COST_APPROACH: "Depreciated replacement cost",
};

/** A concluded value this far from the worksheets' average needs a written reason (10%). */
export const RECONCILIATION_TOLERANCE_BPS = 1000;
/** Fewer comparables than this is allowed only when a limitation says so. */
export const MIN_COMPARABLES = 3;
/** A single net adjustment bigger than this (25%) is flagged for the professional to justify. */
export const LARGE_ADJUSTMENT_BPS = 2500;

const BPS = 10000n;

/** Divide, rounding half away from zero. */
export function divRound(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error("Division by zero");
  const neg = (n < 0n) !== (d < 0n);
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (2n * an + ad) / (2n * ad);
  return neg ? -q : q;
}

/** "12.5" -> 1250 basis points. Up to two decimal places. */
export function parsePercentToBps(input: string, label = "The percentage"): number {
  const m = /^(-?)(\d{1,3})(?:\.(\d{1,2}))?%?$/.exec(input.trim().replace(/\s+/g, ""));
  if (!m) throw new Error(`${label} must be a number such as 12.5`);
  const bps = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0") || "0");
  return m[1] ? -bps : bps;
}

/** "120.5" square metres -> 12050. Up to two decimal places, more than zero. */
export function parseAreaSqm100(input: string, label = "The area"): number {
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(input.trim().replace(/,/g, ""));
  if (!m) throw new Error(`${label} must be in square metres, such as 120.5`);
  const v = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  if (v <= 0) throw new Error(`${label} must be more than zero`);
  return v;
}

export function formatPercent(bps: number): string {
  const sign = bps < 0 ? "-" : "";
  const a = Math.abs(bps);
  const frac = String(a % 100).padStart(2, "0").replace(/0+$/, "");
  return `${sign}${Math.floor(a / 100)}${frac ? "." + frac : ""}%`;
}

export function formatArea(sqm100: number): string {
  const whole = Math.floor(sqm100 / 100);
  const frac = String(sqm100 % 100).padStart(2, "0").replace(/0+$/, "");
  return `${whole}${frac ? "." + frac : ""} m²`;
}

// ---------- Sales comparison ----------

export interface Comparable { priceKobo: bigint; areaSqm100: number; adjustmentBps: number; weightBps: number }
export interface SalesInputs { subjectAreaSqm100: number; comparables: Comparable[] }
export interface Calculation { valueKobo: bigint; lines: { label: string; value: string }[]; warnings: string[] }

/** Adjusted price per square metre for one comparable, in kobo. */
export function adjustedPerSqm(c: Comparable): bigint {
  return divRound(c.priceKobo * 100n * (BPS + BigInt(c.adjustmentBps)), BPS * BigInt(c.areaSqm100));
}

export function salesComparison(i: SalesInputs): Calculation {
  if (i.subjectAreaSqm100 <= 0) throw new Error("Enter the subject's area");
  if (i.comparables.length === 0) throw new Error("Add at least one comparable");
  const warnings: string[] = [];
  let weighted = 0n;
  let totalWeight = 0n;
  const per: bigint[] = [];
  for (const c of i.comparables) {
    if (c.priceKobo <= 0n) throw new Error("Every comparable needs a price");
    if (c.areaSqm100 <= 0) throw new Error("Every comparable needs an area");
    if (c.weightBps < 0) throw new Error("A comparable's weight cannot be negative");
    if (c.adjustmentBps <= -5000 || c.adjustmentBps > 5000) throw new Error("An adjustment must be between -50% and 50%. A comparable that needs more is not comparable");
    if (Math.abs(c.adjustmentBps) > LARGE_ADJUSTMENT_BPS) warnings.push("A comparable carries an adjustment of more than 25%. Record why it is still the best evidence.");
    const p = adjustedPerSqm(c);
    per.push(p);
    weighted += p * BigInt(c.weightBps);
    totalWeight += BigInt(c.weightBps);
  }
  if (totalWeight === 0n) throw new Error("At least one comparable must carry weight");
  const weightedPerSqm = divRound(weighted, totalWeight);
  const value = divRound(weightedPerSqm * BigInt(i.subjectAreaSqm100), 100n);
  const low = per.reduce((a, b) => (b < a ? b : a));
  const high = per.reduce((a, b) => (b > a ? b : a));
  if (i.comparables.length < MIN_COMPARABLES) warnings.push(`Only ${i.comparables.length} comparable${i.comparables.length === 1 ? "" : "s"}: fewer than ${MIN_COMPARABLES}. Record the limitation.`);
  if (low > 0n && divRound((high - low) * BPS, low) > 5000n) warnings.push("Adjusted prices differ by more than 50%. Check the evidence is truly comparable.");
  return {
    valueKobo: value,
    lines: [
      { label: "Weighted adjusted price per m² (kobo)", value: weightedPerSqm.toString() },
      { label: "Lowest / highest adjusted price per m² (kobo)", value: `${low} / ${high}` },
      { label: "Subject area (m²×100)", value: String(i.subjectAreaSqm100) },
    ],
    warnings: [...new Set(warnings)],
  };
}

// ---------- Income capitalisation ----------

export interface IncomeInputs { grossRentKobo: bigint; vacancyBps: number; operatingCostsKobo: bigint; capRateBps: number }

export function incomeCapitalisation(i: IncomeInputs): Calculation {
  if (i.grossRentKobo <= 0n) throw new Error("Enter the gross annual rent");
  if (i.vacancyBps < 0 || i.vacancyBps > 10000) throw new Error("Vacancy allowance must be between 0% and 100%");
  if (i.operatingCostsKobo < 0n) throw new Error("Operating costs cannot be negative");
  if (i.capRateBps < 100 || i.capRateBps > 5000) throw new Error("The capitalisation rate must be between 1% and 50%");
  const effective = divRound(i.grossRentKobo * (BPS - BigInt(i.vacancyBps)), BPS);
  const noi = effective - i.operatingCostsKobo;
  if (noi <= 0n) throw new Error("Net operating income is not positive, so the income method cannot give a value");
  const value = divRound(noi * BPS, BigInt(i.capRateBps));
  const warnings: string[] = [];
  if (i.vacancyBps === 0) warnings.push("No vacancy allowance. Record why none is made.");
  return {
    valueKobo: value,
    lines: [
      { label: "Effective gross income (kobo)", value: effective.toString() },
      { label: "Net operating income (kobo)", value: noi.toString() },
      { label: "Capitalisation rate", value: formatPercent(i.capRateBps) },
    ],
    warnings,
  };
}

// ---------- Depreciated replacement cost ----------

export interface CostInputs { landValueKobo: bigint; costPerSqmKobo: bigint; buildingAreaSqm100: number; depreciationBps: number }

export function costApproach(i: CostInputs): Calculation {
  if (i.landValueKobo < 0n) throw new Error("Land value cannot be negative");
  if (i.costPerSqmKobo <= 0n) throw new Error("Enter the replacement cost per square metre");
  if (i.buildingAreaSqm100 <= 0) throw new Error("Enter the building area");
  if (i.depreciationBps < 0 || i.depreciationBps > 10000) throw new Error("Depreciation must be between 0% and 100%");
  const gross = divRound(i.costPerSqmKobo * BigInt(i.buildingAreaSqm100), 100n);
  const depreciated = divRound(gross * (BPS - BigInt(i.depreciationBps)), BPS);
  const warnings: string[] = [];
  if (i.landValueKobo === 0n) warnings.push("Land value is zero. Record why.");
  if (i.depreciationBps === 0) warnings.push("No depreciation. Record why the building is treated as new.");
  return {
    valueKobo: i.landValueKobo + depreciated,
    lines: [
      { label: "Replacement cost new (kobo)", value: gross.toString() },
      { label: "After depreciation (kobo)", value: depreciated.toString() },
      { label: "Land (kobo)", value: i.landValueKobo.toString() },
    ],
    warnings,
  };
}

// ---------- Reconciliation and readiness ----------

/** How far the concluded value is from the average of the worksheet results, in basis points (0 when there are none). */
export function deviationBps(results: bigint[], concluded: bigint): number {
  if (results.length === 0) return 0;
  const mean = divRound(results.reduce((a, b) => a + b, 0n), BigInt(results.length));
  if (mean === 0n) return 0;
  const d = divRound((concluded - mean) * BPS, mean);
  return Number(d < 0n ? -d : d);
}

export interface ReadinessInput {
  premise: Premise;
  valuationDate: Date | null;
  today: Date;
  professionalName: string;
  professionalBody: string;
  registrationNo: string;
  assetDescription: string;
  entries: { kind: EntryKind }[];
  worksheets: { method: Method; resultKobo: bigint | null; comparableCount: number }[];
  concludedValueKobo: bigint | null;
  reconciliationNote: string;
  summary: string;
  conclusion: string;
}

/** What stops a report going for approval (blockers) and what the approver should look at (warnings). */
export function reportReadiness(r: ReadinessInput): { blockers: string[]; warnings: string[] } {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const has = (k: EntryKind) => r.entries.some((e) => e.kind === k);
  if (!r.valuationDate) blockers.push("Record the valuation date");
  else if (r.valuationDate.getTime() > r.today.getTime()) blockers.push("The valuation date cannot be in the future");
  if (!r.assetDescription.trim()) blockers.push("Describe the asset being valued");
  if (!r.professionalName.trim() || !r.professionalBody.trim() || !r.registrationNo.trim()) {
    blockers.push("Record the valuing professional's name, professional body and registration number");
  }
  const calculated = r.worksheets.filter((w) => w.resultKobo !== null);
  if (calculated.length === 0) blockers.push("Complete at least one valuation worksheet");
  if (r.premise !== "STANDARD" && !has("PREMISE")) {
    blockers.push(`Record the premise for the ${r.premise === "GOING_CONCERN" ? "going-concern" : "gone-concern"} valuation`);
  }
  if (!has("LIMITATION")) blockers.push("Record at least one limitation of the valuation");
  if (!r.summary.trim() || !r.conclusion.trim()) blockers.push("Write the summary and the conclusion");
  if (r.concludedValueKobo === null || r.concludedValueKobo <= 0n) blockers.push("Enter the concluded value");
  else if (calculated.length > 0) {
    const dev = deviationBps(calculated.map((w) => w.resultKobo as bigint), r.concludedValueKobo);
    if (dev > RECONCILIATION_TOLERANCE_BPS && !r.reconciliationNote.trim()) {
      blockers.push(`The concluded value is ${formatPercent(dev)} away from the worksheets. Explain the difference`);
    }
  }
  for (const w of r.worksheets) {
    if (w.method === "SALES_COMPARISON" && w.comparableCount < MIN_COMPARABLES && !has("LIMITATION")) {
      blockers.push(`The sales comparison has fewer than ${MIN_COMPARABLES} comparables. Record the limitation`);
    }
  }
  if (calculated.length === 1) warnings.push("Only one method was used. Consider a second as a cross-check.");
  if (r.premise === "GONE_CONCERN" && calculated.some((w) => w.method === "INCOME_CAPITALISATION")) {
    warnings.push("The income method assumes the business continues. Check it suits a gone-concern premise.");
  }
  return { blockers: [...new Set(blockers)], warnings };
}

/** Who may approve a valuation report. A second person decides, and AI-assisted text needs the approver's own review. */
export function reportApprovalProblem(a: { authorId: string; approverId: string; aiAssisted: boolean; confirmedReviewed: boolean }): string | null {
  if (a.approverId === a.authorId) return "A different person must approve the report. You prepared it.";
  if (a.aiAssisted && !a.confirmedReviewed) return "This report used AI assistance. Confirm you have reviewed every part of it yourself before you decide";
  return null;
}
