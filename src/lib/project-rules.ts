// Project cost, schedule and control rules (master prompt Phase 7). Pure functions with BigInt kobo,
// so the same inputs always give the same figures. Decisions about spending are made by a second person.

export const PROJECT_KINDS = ["CONSTRUCTION", "RENOVATION", "FIT_OUT", "REPAIR_PROGRAMME"] as const;
export const WORK_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "DONE", "BLOCKED"] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

/** A work package this many points behind its straight-line plan is "behind". */
export const BEHIND_POINTS = 15;

const DAY = 86_400_000;

export function budgetTotal(workPackageBudgets: bigint[], contingencyKobo: bigint): bigint {
  return workPackageBudgets.reduce((a, b) => a + b, 0n) + contingencyKobo;
}

/** Whole days from a to b (b - a). Both are date-only UTC values. */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY);
}

/** Where a work package should be today if it progressed in a straight line from start to end (0 to 100). */
export function plannedPercent(start: Date, end: Date, today: Date): number {
  if (today.getTime() < start.getTime()) return 0;
  if (today.getTime() >= end.getTime()) return 100;
  const span = daysBetween(start, end) + 1;
  const done = daysBetween(start, today) + 1;
  return Math.min(100, Math.max(0, Math.floor((done * 100) / span)));
}

export type WorkState = "DONE" | "NOT_STARTED" | "LATE" | "BEHIND" | "BLOCKED" | "ON_TRACK";

export function workState(w: { status: WorkStatus; percentComplete: number; plannedStart: Date; plannedEnd: Date }, today: Date): WorkState {
  if (w.status === "DONE") return "DONE";
  if (w.status === "BLOCKED") return "BLOCKED";
  if (w.plannedEnd.getTime() < today.getTime()) return "LATE";
  if (w.status === "NOT_STARTED" && w.plannedStart.getTime() > today.getTime()) return "NOT_STARTED";
  if (w.percentComplete + BEHIND_POINTS < plannedPercent(w.plannedStart, w.plannedEnd, today)) return "BEHIND";
  return "ON_TRACK";
}

/** Overall percent complete, weighted by each package's budget (or equally when no package has a budget). */
export function overallPercent(packages: { percentComplete: number; budgetKobo: bigint }[]): number {
  if (packages.length === 0) return 0;
  const total = packages.reduce((a, p) => a + p.budgetKobo, 0n);
  if (total === 0n) return Math.round(packages.reduce((a, p) => a + p.percentComplete, 0) / packages.length);
  const weighted = packages.reduce((a, p) => a + p.budgetKobo * BigInt(p.percentComplete), 0n);
  return Number((weighted * 2n + total) / (total * 2n));
}

/** Setting a status and a percentage together: done means 100%, and 100% means done. */
export function normaliseProgress(status: WorkStatus, percent: number): { status: WorkStatus; percentComplete: number } {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new Error("Progress must be a whole number from 0 to 100");
  if (status === "DONE") return { status, percentComplete: 100 };
  if (percent === 100) return { status: "DONE", percentComplete: 100 };
  if (status === "NOT_STARTED" && percent > 0) return { status: "IN_PROGRESS", percentComplete: percent };
  if (status === "IN_PROGRESS" && percent === 0) return { status: "NOT_STARTED", percentComplete: 0 };
  return { status, percentComplete: percent };
}

// ---------- Cost control ----------

export interface CostInputs {
  approvedBudgetKobo: bigint | null;
  contingencyKobo: bigint;
  packages: { id: string; budgetKobo: bigint }[];
  /** Approved commitments with their approved variations already applied. */
  commitments: { workPackageId: string | null; contractKobo: bigint }[];
  /** Invoices that count as cost: approved or paid. */
  invoices: { workPackageId: string | null; amountKobo: bigint; paid: boolean }[];
  /** Latest estimate to complete for each work package that has one. */
  forecasts: { workPackageId: string; etcKobo: bigint }[];
}

export interface PackageCost { id: string | null; budgetKobo: bigint; committedKobo: bigint; invoicedKobo: bigint; paidKobo: bigint; etcKobo: bigint | null; forecastKobo: bigint; overrunKobo: bigint }

export interface CostSummary {
  budgetKobo: bigint;
  committedKobo: bigint;
  invoicedKobo: bigint;
  paidKobo: bigint;
  forecastKobo: bigint;
  /** Approved budget left uncommitted (can be negative only if data was entered around the checks). */
  uncommittedKobo: bigint;
  /** Forecast at completion against the approved budget (positive means under budget). */
  varianceKobo: bigint;
  overrunKobo: bigint;
  contingencyLeftKobo: bigint;
  overBudget: boolean;
  packages: PackageCost[];
}

/** Forecast at completion is cost to date plus the estimate to complete. Without an estimate it is the larger of what is committed and what has been invoiced. */
export function costSummary(i: CostInputs): CostSummary {
  const ids: (string | null)[] = [...i.packages.map((p) => p.id), null];
  const packages: PackageCost[] = ids.map((id) => {
    const budget = id ? i.packages.find((p) => p.id === id)!.budgetKobo : 0n;
    const committed = i.commitments.filter((c) => c.workPackageId === id).reduce((a, c) => a + c.contractKobo, 0n);
    const invoices = i.invoices.filter((x) => x.workPackageId === id);
    const invoiced = invoices.reduce((a, x) => a + x.amountKobo, 0n);
    const paid = invoices.filter((x) => x.paid).reduce((a, x) => a + x.amountKobo, 0n);
    const etc = id ? i.forecasts.find((f) => f.workPackageId === id)?.etcKobo ?? null : null;
    const forecast = etc !== null ? invoiced + etc : committed > invoiced ? committed : invoiced;
    const overrun = forecast > budget ? forecast - budget : 0n;
    return { id, budgetKobo: budget, committedKobo: committed, invoicedKobo: invoiced, paidKobo: paid, etcKobo: etc, forecastKobo: forecast, overrunKobo: overrun };
  });
  const sum = (f: (p: PackageCost) => bigint) => packages.reduce((a, p) => a + f(p), 0n);
  const budget = i.approvedBudgetKobo ?? budgetTotal(i.packages.map((p) => p.budgetKobo), i.contingencyKobo);
  const committed = sum((p) => p.committedKobo);
  const forecast = sum((p) => p.forecastKobo);
  const overrun = sum((p) => p.overrunKobo);
  return {
    budgetKobo: budget, committedKobo: committed, invoicedKobo: sum((p) => p.invoicedKobo), paidKobo: sum((p) => p.paidKobo), forecastKobo: forecast,
    uncommittedKobo: budget - committed, varianceKobo: budget - forecast, overrunKobo: overrun, contingencyLeftKobo: i.contingencyKobo - overrun,
    overBudget: forecast > budget, packages,
  };
}

/** A commitment may not take total commitments past the approved budget. Raise the budget with an approved variation first. */
export function commitmentProblem(a: { approvedBudgetKobo: bigint | null; committedKobo: bigint; amountKobo: bigint }): string | null {
  if (a.amountKobo <= 0n) return "The amount must be more than zero";
  if (a.approvedBudgetKobo === null) return "The project budget has not been approved yet";
  if (a.committedKobo + a.amountKobo > a.approvedBudgetKobo) return "This would commit more than the approved budget. Raise the budget with an approved variation first";
  return null;
}

/** An invoice may not take cost on a commitment past its contract sum (the amount plus approved variations). */
export function invoiceProblem(a: { contractKobo: bigint; invoicedSoFarKobo: bigint; amountKobo: bigint }): string | null {
  if (a.amountKobo <= 0n) return "The invoice amount must be more than zero";
  if (a.invoicedSoFarKobo + a.amountKobo > a.contractKobo) return "This invoice would take the total past the contract sum. Raise a variation first";
  return null;
}

/** Why a project cannot start yet. */
export function activationProblems(p: { budgetApproved: boolean; hasManager: boolean; packageCount: number }): string[] {
  const out: string[] = [];
  if (!p.budgetApproved) out.push("The budget must be approved by a second person");
  if (!p.hasManager) out.push("Assign a project manager");
  if (p.packageCount === 0) out.push("Add at least one work package");
  return out;
}

/** Date checks for a package inside its project. Returns warnings, never blocks. */
export function scheduleWarnings(project: { plannedStart: Date; plannedEnd: Date }, w: { plannedStart: Date; plannedEnd: Date }): string[] {
  const out: string[] = [];
  if (w.plannedStart.getTime() < project.plannedStart.getTime() || w.plannedEnd.getTime() > project.plannedEnd.getTime()) out.push("Planned dates fall outside the project's dates");
  return out;
}

/** The approved extra time a variation adds to the end date. */
export function extendedEnd(end: Date, days: number): Date {
  return new Date(end.getTime() + days * DAY);
}
