// Rules for the owner, vendor and professional-services portals (master prompt §39).
// Pure functions, so they can be tested without a database.

export type PortalKind = "OWNER" | "VENDOR";
export type GrantStatus = "INVITED" | "ACTIVE" | "REVOKED";
export type SubmissionKind = "QUOTE" | "INVOICE" | "COMPLETION";
export type SubmissionStatus = "SUBMITTED" | "ACCEPTED" | "REJECTED";

export const PORTAL_LABELS: Record<PortalKind, string> = { OWNER: "Owner", VENDOR: "Vendor" };
export const GRANT_STATUS_LABELS: Record<GrantStatus, string> = { INVITED: "Invited", ACTIVE: "Active", REVOKED: "Access removed" };
export const SUBMISSION_LABELS: Record<SubmissionKind, string> = { QUOTE: "Quotation", INVOICE: "Invoice", COMPLETION: "Completion report" };
export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = { SUBMITTED: "Waiting for the company", ACCEPTED: "Accepted", REJECTED: "Not accepted" };

/** Most assets one owner invitation may cover; bigger portfolios are split across invitations. */
export const MAX_GRANT_ASSETS = 50;

/** Work-order stages a vendor can see. Before assignment the job is the company's internal business. */
export const VENDOR_VISIBLE = ["ASSIGNED", "IN_PROGRESS", "AWAITING_PARTS", "INSPECTION_REQUIRED", "COMPLETED", "CLOSED"] as const;

/** Which documents a vendor may send at each stage of the job. */
const SUBMIT_AT: Record<SubmissionKind, readonly string[]> = {
  QUOTE: ["ASSIGNED", "IN_PROGRESS", "AWAITING_PARTS"],
  COMPLETION: ["IN_PROGRESS", "AWAITING_PARTS", "INSPECTION_REQUIRED"],
  INVOICE: ["IN_PROGRESS", "AWAITING_PARTS", "INSPECTION_REQUIRED", "COMPLETED", "CLOSED"],
};

export function vendorCanSee(status: string): boolean {
  return (VENDOR_VISIBLE as readonly string[]).includes(status);
}

export function canSubmit(kind: SubmissionKind, workOrderStatus: string): boolean {
  return SUBMIT_AT[kind].includes(workOrderStatus);
}

export function submittableKinds(workOrderStatus: string): SubmissionKind[] {
  return (Object.keys(SUBMIT_AT) as SubmissionKind[]).filter((k) => canSubmit(k, workOrderStatus));
}

/** "150,000" or "150000.50" naira to kobo. Null when blank; throws on nonsense. */
export function parseNaira(raw: string): bigint | null {
  const s = raw.replace(/[₦,\s]/g, "");
  if (s === "") return null;
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(s)) throw new Error("Enter the amount in naira, for example 150000");
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole) * BigInt(100) + BigInt((frac + "00").slice(0, 2));
}

/** Check what a vendor sends before it is stored. Returns the problems, empty when fine. */
export function checkSubmissionInput(kind: SubmissionKind, workOrderStatus: string, amountKobo: bigint | null, note: string): string[] {
  const out: string[] = [];
  if (!canSubmit(kind, workOrderStatus)) out.push(`You cannot send a ${SUBMISSION_LABELS[kind].toLowerCase()} while the job is at this stage`);
  if (kind !== "COMPLETION" && (amountKobo === null || amountKobo <= BigInt(0))) out.push("Enter the amount");
  if (kind === "COMPLETION" && note.trim().length < 10) out.push("Describe the work you completed");
  if (note.length > 2000) out.push("Keep the note under 2,000 characters");
  return out;
}

/** What accepting a submission changes on the work order. */
export function acceptEffect(kind: SubmissionKind, amountKobo: bigint | null): { estimatedCostKobo?: bigint; actualCostKobo?: bigint } {
  if (kind === "QUOTE" && amountKobo !== null) return { estimatedCostKobo: amountKobo };
  if (kind === "INVOICE" && amountKobo !== null) return { actualCostKobo: amountKobo };
  return {};
}

// ---------- Professional services providers ----------

export type LeadStatus = "SUBMITTED" | "CONTACTED" | "IN_PROGRESS" | "CLOSED" | "WITHDRAWN" | "DECLINED";

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  SUBMITTED: "New", CONTACTED: "Contacted", IN_PROGRESS: "In progress", CLOSED: "Closed", WITHDRAWN: "Withdrawn by the person", DECLINED: "Declined",
};

const LEAD_NEXT: Record<LeadStatus, LeadStatus[]> = {
  SUBMITTED: ["CONTACTED", "DECLINED"],
  CONTACTED: ["IN_PROGRESS", "CLOSED", "DECLINED"],
  IN_PROGRESS: ["CLOSED"],
  CLOSED: [],
  WITHDRAWN: [],
  DECLINED: [],
};

export function leadNext(status: LeadStatus): LeadStatus[] {
  return LEAD_NEXT[status] ?? [];
}

export function canMoveLead(from: LeadStatus, to: LeadStatus): boolean {
  return leadNext(from).includes(to);
}

// ---------- Owner portal summaries ----------

type Charge = { dueDate: Date; amountKobo: bigint; adjustedKobo: bigint; paidKobo: bigint };

/** Rent position for the owner: what has fallen due, what was paid, what is overdue, and the next due date. */
export function rentPosition(charges: Charge[], today: Date) {
  let dueKobo = BigInt(0), paidKobo = BigInt(0), overdueKobo = BigInt(0);
  let next: Date | null = null;
  const day = today.toISOString().slice(0, 10);
  for (const c of charges) {
    const owed = c.amountKobo + c.adjustedKobo;
    const d = c.dueDate.toISOString().slice(0, 10);
    if (d <= day) {
      dueKobo += owed;
      paidKobo += c.paidKobo;
      if (c.paidKobo < owed) overdueKobo += owed - c.paidKobo;
    } else if (!next || c.dueDate < next) {
      next = c.dueDate;
    }
  }
  return { dueKobo, paidKobo, overdueKobo, nextDue: next };
}
