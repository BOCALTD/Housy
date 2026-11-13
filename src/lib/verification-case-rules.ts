/**
 * Verification cases (stages 4 to 6 of the verification network): pure rules, no database.
 *  - Every status a case can be in, which may follow which, and who may make each move. Mandatory reviews cannot be
 *    skipped: a report reaches the customer only after the provider's internal review and Housy's own review.
 *  - Which providers may take a case, and how eligible ones are ranked for Housy (or the customer) to choose from.
 *  - Report outcomes and findings: never a bare "verified"; every finding says what kind of evidence it rests on.
 */
import type { VpRole } from "./verification-network-rules";
import { vpCan } from "./verification-network-rules";

export const CASE_STATUSES = [
  "REQUESTED", "PENDING_PAYMENT", "READY_FOR_ASSIGNMENT", "ASSIGNED", "ACCEPTED", "DOCUMENT_REVIEW", "INFORMATION_REQUIRED",
  "FIELD_INSPECTION", "INVESTIGATION_IN_PROGRESS", "REPORT_DRAFT", "INTERNAL_REVIEW", "CORRECTION_REQUIRED", "SUBMITTED_TO_HOUSY",
  "PLATFORM_REVIEW", "APPROVED_FOR_RELEASE", "DELIVERED", "COMPLETED", "REJECTED", "CANCELLED", "DISPUTED",
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];
export const FINAL_CASE_STATUSES: CaseStatus[] = ["COMPLETED", "REJECTED", "CANCELLED"];

export const CASE_STATUS_WORDS: Record<CaseStatus, string> = {
  REQUESTED: "Requested",
  PENDING_PAYMENT: "Waiting for payment",
  READY_FOR_ASSIGNMENT: "Finding a provider",
  ASSIGNED: "Offered to a provider",
  ACCEPTED: "Accepted by the provider",
  DOCUMENT_REVIEW: "Reviewing documents",
  INFORMATION_REQUIRED: "More information needed",
  FIELD_INSPECTION: "Site inspection",
  INVESTIGATION_IN_PROGRESS: "Investigation in progress",
  REPORT_DRAFT: "Report being written",
  INTERNAL_REVIEW: "Provider's internal review",
  CORRECTION_REQUIRED: "Corrections being made",
  SUBMITTED_TO_HOUSY: "Submitted to Housy",
  PLATFORM_REVIEW: "Housy quality review",
  APPROVED_FOR_RELEASE: "Approved for release",
  DELIVERED: "Report delivered",
  COMPLETED: "Completed",
  REJECTED: "Not taken on",
  CANCELLED: "Cancelled",
  DISPUTED: "Disputed",
};

/** Who moves a case: the customer who asked, Housy (an administrator, or the system), or the provider (with a permission). */
export type Mover = { kind: "customer" } | { kind: "platform" } | { kind: "provider"; role: VpRole };

type Rule = { to: CaseStatus; by: "customer" | "platform" | `provider:${string}` };
const R = (to: CaseStatus, ...by: Rule["by"][]) => by.map((b) => ({ to, by: b }));
const MOVES: Record<CaseStatus, Rule[]> = {
  REQUESTED: [...R("PENDING_PAYMENT", "platform"), ...R("READY_FOR_ASSIGNMENT", "platform"), ...R("REJECTED", "platform"), ...R("CANCELLED", "customer", "platform")],
  PENDING_PAYMENT: [...R("READY_FOR_ASSIGNMENT", "platform"), ...R("CANCELLED", "customer", "platform")],
  READY_FOR_ASSIGNMENT: [...R("ASSIGNED", "platform"), ...R("CANCELLED", "customer", "platform"), ...R("REJECTED", "platform")],
  // An offered case is accepted or declined by the provider; Housy can take it back (time-out or reassignment).
  ASSIGNED: [...R("ACCEPTED", "provider:case.accept"), ...R("READY_FOR_ASSIGNMENT", "provider:case.accept", "platform"), ...R("CANCELLED", "platform")],
  ACCEPTED: [...R("DOCUMENT_REVIEW", "provider:case.work", "provider:case.assign"), ...R("CANCELLED", "platform")],
  DOCUMENT_REVIEW: [...R("INFORMATION_REQUIRED", "provider:case.work"), ...R("FIELD_INSPECTION", "provider:case.work"), ...R("INVESTIGATION_IN_PROGRESS", "provider:case.work"), ...R("CANCELLED", "platform")],
  INFORMATION_REQUIRED: [...R("DOCUMENT_REVIEW", "customer", "provider:case.work"), ...R("CANCELLED", "customer", "platform")],
  FIELD_INSPECTION: [...R("INVESTIGATION_IN_PROGRESS", "provider:case.work"), ...R("CANCELLED", "platform")],
  INVESTIGATION_IN_PROGRESS: [...R("FIELD_INSPECTION", "provider:case.work"), ...R("INFORMATION_REQUIRED", "provider:case.work"), ...R("REPORT_DRAFT", "provider:case.work"), ...R("CANCELLED", "platform")],
  REPORT_DRAFT: [...R("INTERNAL_REVIEW", "provider:case.work"), ...R("CANCELLED", "platform")],
  // The provider's own professional review: a reviewer sends it back or approves it for Housy. Nobody skips it.
  INTERNAL_REVIEW: [...R("CORRECTION_REQUIRED", "provider:case.review"), ...R("SUBMITTED_TO_HOUSY", "provider:case.review"), ...R("CANCELLED", "platform")],
  CORRECTION_REQUIRED: [...R("REPORT_DRAFT", "provider:case.work"), ...R("CANCELLED", "platform")],
  SUBMITTED_TO_HOUSY: [...R("PLATFORM_REVIEW", "platform")],
  // Housy's quality and compliance review is separate from the provider's professional opinion.
  PLATFORM_REVIEW: [...R("APPROVED_FOR_RELEASE", "platform"), ...R("CORRECTION_REQUIRED", "platform"), ...R("CANCELLED", "platform")],
  APPROVED_FOR_RELEASE: [...R("DELIVERED", "platform")],
  DELIVERED: [...R("COMPLETED", "customer", "platform"), ...R("DISPUTED", "customer")],
  DISPUTED: [...R("PLATFORM_REVIEW", "platform"), ...R("COMPLETED", "platform")],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
};

export function canMoveCase(from: CaseStatus, to: CaseStatus, by: Mover): boolean {
  return MOVES[from].some((r) => {
    if (r.to !== to) return false;
    if (r.by === "customer" || r.by === "platform") return r.by === by.kind;
    return by.kind === "provider" && vpCan(by.role, r.by.slice("provider:".length) as Parameters<typeof vpCan>[1]);
  });
}
export const nextCaseStatuses = (from: CaseStatus, by: Mover) => CASE_STATUSES.filter((to) => canMoveCase(from, to, by));
/** Statuses in which the provider is working on the case (for counting workload). */
export const OPEN_PROVIDER_STATUSES: CaseStatus[] = ["ASSIGNED", "ACCEPTED", "DOCUMENT_REVIEW", "INFORMATION_REQUIRED", "FIELD_INSPECTION", "INVESTIGATION_IN_PROGRESS", "REPORT_DRAFT", "INTERNAL_REVIEW", "CORRECTION_REQUIRED"];

const pad = (n: number, w: number) => String(n).padStart(w, "0");
export const caseRef = (year: number, n: number) => `HVR-${year}-${pad(n, 6)}`;
export const isCaseRef = (s: string) => /^HVR-\d{4}-\d{6}$/.test(s);

// ---------- Choosing a provider ----------

export type Candidate = {
  providerId: string;
  name: string;
  vetted: boolean;
  active: boolean;
  allowedServices: string[];
  offeredServices: string[];
  allowedStates: string[];
  coveredStates: string[];
  conflict: boolean;
  openCases: number;
  monthlyCapacity: number;
  completed: number;
  onTime: number;
  declined: number;
  offered: number;
  /** Total price for the requested services in kobo, or null when any is quoted per case. */
  priceKobo: bigint | null;
  turnaroundDays: number;
};
export type Ranked = Candidate & { eligible: boolean; reasons: string[]; score: number };

/**
 * Who may take a case, and in what order. Not eligible: not vetted, suspended, not approved for or not offering every
 * requested service, not approved for or not working in the property's state, a declared conflict of interest, or full.
 * Eligible ones are ranked by measured performance (finished on time, rarely declining), spare capacity, then price and
 * speed. Every reason is given in words, so a choice can be explained and audited.
 */
export function rankProviders(c: { services: string[]; state: string }, list: Candidate[]): Ranked[] {
  const out = list.map((p): Ranked => {
    const reasons: string[] = [];
    if (!p.vetted) reasons.push("not vetted through the network");
    if (!p.active) reasons.push("suspended or not approved");
    const notAllowed = c.services.filter((s) => !p.allowedServices.includes(s));
    if (notAllowed.length) reasons.push(`not approved for ${notAllowed.length} of the requested services`);
    const notOffered = c.services.filter((s) => p.allowedServices.includes(s) && !p.offeredServices.includes(s));
    if (notOffered.length) reasons.push(`does not offer ${notOffered.length} of the requested services`);
    if (!p.allowedStates.includes(c.state)) reasons.push(`not approved for ${c.state}`);
    else if (!p.coveredStates.includes(c.state)) reasons.push(`does not work in ${c.state}`);
    if (p.conflict) reasons.push("declared a conflict of interest");
    if (p.monthlyCapacity > 0 && p.openCases >= p.monthlyCapacity) reasons.push("at full capacity");
    const eligible = reasons.length === 0;
    // Performance counts only once there is a record; a new provider starts in the middle, neither helped nor harmed.
    const onTimeRate = p.completed >= 3 ? p.onTime / p.completed : 0.75;
    const declineRate = p.offered >= 3 ? p.declined / p.offered : 0.1;
    const spare = p.monthlyCapacity > 0 ? 1 - p.openCases / p.monthlyCapacity : 0.5;
    const score = eligible ? Math.round((onTimeRate * 50 + (1 - declineRate) * 20 + spare * 20 + Math.max(0, 10 - p.turnaroundDays / 3)) * 10) / 10 : 0;
    return { ...p, eligible, reasons, score };
  });
  return out.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score || Number((a.priceKobo ?? 0n) - (b.priceKobo ?? 0n)) || a.name.localeCompare(b.name));
}

// ---------- Reports ----------

export const OUTCOMES = [
  ["SATISFACTORY_WITHIN_SCOPE", "Satisfactory within scope"],
  ["SATISFACTORY_WITH_CONDITIONS", "Satisfactory with conditions"],
  ["INCONCLUSIVE", "Inconclusive"],
  ["MATERIAL_DISCREPANCIES", "Material discrepancies identified"],
  ["ADVERSE_FINDINGS", "Adverse findings"],
  ["UNABLE_TO_VERIFY", "Unable to verify"],
  ["ADDITIONAL_INVESTIGATION_REQUIRED", "Additional investigation required"],
] as const;
export type Outcome = (typeof OUTCOMES)[number][0];
export const OUTCOME_CODES = OUTCOMES.map((o) => o[0]);

/** What a finding rests on. A document check or a registry search is never presented as proof of ownership. */
export const FINDING_BASES = [
  ["DOCUMENTARY", "Documents examined"],
  ["REGISTRY", "Registry search"],
  ["PHYSICAL", "Physical observation"],
  ["OPINION", "Professional opinion"],
] as const;
export type FindingBasis = (typeof FINDING_BASES)[number][0];

export type ReportContent = {
  scope: string;
  documentsExamined: string;
  sourcesConsulted: string;
  registrySearch: string;
  siteInspection: string;
  findings: { basis: FindingBasis; text: string }[];
  risks: string;
  limitations: string;
  outstanding: string;
  observations: string;
  recommendations: string;
  conclusion: string;
  outcome: Outcome;
};

/** Everything a report must have before it can go for review; empty when it is ready. */
export function reportGaps(r: Partial<ReportContent>): string[] {
  const gaps: string[] = [];
  if (!r.scope?.trim()) gaps.push("Say what the investigation covered (scope)");
  if (!r.findings?.length || r.findings.every((f) => !f.text.trim())) gaps.push("Add at least one finding, saying what it rests on");
  if (!r.limitations?.trim()) gaps.push("State the limitations of the investigation");
  if (!r.conclusion?.trim()) gaps.push("Write the conclusion");
  if (!r.outcome || !OUTCOME_CODES.includes(r.outcome)) gaps.push("Choose the outcome");
  if (r.outcome === "SATISFACTORY_WITH_CONDITIONS" && !r.recommendations?.trim()) gaps.push("Give the conditions (in recommendations)");
  if ((r.outcome === "MATERIAL_DISCREPANCIES" || r.outcome === "ADVERSE_FINDINGS") && !r.risks?.trim()) gaps.push("Describe the discrepancies or adverse findings (in risks)");
  return gaps;
}

/** A canonical form of a report version for its fingerprint: the same content always gives the same hash. */
export function canonicalReport(v: { caseRef: string; providerCode: string; version: number; content: ReportContent; preparedBy: string; reviewedBy: string; approvedAt: string }): string {
  const sortKeys = (x: unknown): unknown => (Array.isArray(x) ? x.map(sortKeys) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, sortKeys((x as Record<string, unknown>)[k])])) : x);
  return JSON.stringify(sortKeys(v));
}
