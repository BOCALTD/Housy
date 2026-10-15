// Pure rules for work orders (master prompt Section 18). Nothing here touches the database.

export type WoStatus =
  | "REPORTED" | "TRIAGED" | "APPROVED" | "ASSIGNED" | "IN_PROGRESS" | "AWAITING_PARTS"
  | "INSPECTION_REQUIRED" | "COMPLETED" | "CLOSED" | "CANCELLED";
export type WoPriority = "LOW" | "NORMAL" | "HIGH" | "EMERGENCY";

export const WO_FLOW: WoStatus[] = [
  "REPORTED", "TRIAGED", "APPROVED", "ASSIGNED", "IN_PROGRESS", "AWAITING_PARTS", "INSPECTION_REQUIRED", "COMPLETED", "CLOSED",
];
export const OPEN_STATUSES: WoStatus[] = ["REPORTED", "TRIAGED", "APPROVED", "ASSIGNED", "IN_PROGRESS", "AWAITING_PARTS", "INSPECTION_REQUIRED", "COMPLETED"];

const NEXT: Record<WoStatus, WoStatus[]> = {
  REPORTED: ["TRIAGED", "CANCELLED"],
  TRIAGED: ["APPROVED", "CANCELLED"],
  APPROVED: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["AWAITING_PARTS", "INSPECTION_REQUIRED", "COMPLETED", "CANCELLED"],
  AWAITING_PARTS: ["IN_PROGRESS", "CANCELLED"],
  INSPECTION_REQUIRED: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
  COMPLETED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: [],
  CANCELLED: [],
};

/**
 * Whether a work order may move from one status to another. An emergency may go straight from
 * reported or triaged to assigned or in progress, so urgent repairs are never held up waiting for
 * approval. Its cost must still be approved before it can be closed.
 */
export function transitionProblem(from: WoStatus, to: WoStatus, priority: WoPriority): string | null {
  if (NEXT[from].includes(to)) return null;
  if (priority === "EMERGENCY" && (from === "REPORTED" || from === "TRIAGED") && (to === "ASSIGNED" || to === "IN_PROGRESS")) return null;
  if (from === "CLOSED") return "This work order is closed";
  if (from === "CANCELLED") return "This work order was cancelled";
  return `A work order cannot go from ${label(from)} to ${label(to)}`;
}

function label(s: WoStatus) {
  const t = s.toLowerCase().replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Why work cannot be marked complete yet, or null. Completion needs notes and evidence of the work. */
export function completionProblem(input: { notes: string; hasAfterPhoto: boolean; evidenceRef: string }): string | null {
  if (input.notes.trim().length < 5) return "Describe the work that was done";
  if (!input.hasAfterPhoto && input.evidenceRef.trim().length < 3) {
    return "Add an after photograph or a job card or invoice reference as evidence of completion";
  }
  return null;
}

/** Why a completed work order cannot be closed, or null. Closing is the verification step. */
export function closureProblem(input: {
  status: WoStatus; approvedById: string | null; approvedCostKobo: bigint | null; actualCostKobo: bigint | null;
  completedByUserId: string | null; assigneeUserId: string | null; verifierUserId: string;
}): string | null {
  if (input.status !== "COMPLETED") return "Only completed work can be verified and closed";
  if (input.verifierUserId === input.completedByUserId || input.verifierUserId === input.assigneeUserId) {
    return "Completion must be verified by someone other than the person who did or recorded the work";
  }
  if (!input.approvedById) return "The cost must be approved before this work order can be closed";
  if (input.actualCostKobo !== null && input.approvedCostKobo !== null && input.actualCostKobo > input.approvedCostKobo) {
    return "The actual cost is more than the approved cost. Approve the higher amount first.";
  }
  return null;
}

export function materialsTotal(items: { quantity: number; unitCostKobo: bigint }[]): bigint {
  return items.reduce((s, m) => s + BigInt(m.quantity) * m.unitCostKobo, 0n);
}

/** How long urgent work may sit before it is flagged on the compliance calendar. */
export const URGENT_UNATTENDED_HOURS = 24;

/** Whether an urgent order has sat unattended past the allowed time. Used for escalation. */
export function isUnattendedUrgent(input: {
  priority: WoPriority; riskLevel: string; safetyRisk: boolean; status: WoStatus; createdAt: Date; now: Date; hours: number;
}): boolean {
  const urgent = input.priority === "EMERGENCY" || input.riskLevel === "CRITICAL" || input.safetyRisk;
  if (!urgent) return false;
  if (input.status !== "REPORTED" && input.status !== "TRIAGED" && input.status !== "APPROVED") return false;
  return input.now.getTime() - input.createdAt.getTime() >= input.hours * 3_600_000;
}

/** Due dates of a preventive schedule that need a work order now: from `leadDays` before each due date. */
export function dueOccurrences(nextDueOn: Date, intervalMonths: number, leadDays: number, today: Date, addMonths: (d: Date, n: number) => Date, cap = 12): Date[] {
  const out: Date[] = [];
  let due = nextDueOn;
  while (out.length < cap && due.getTime() - leadDays * 86_400_000 <= today.getTime()) {
    out.push(due);
    due = addMonths(due, intervalMonths);
  }
  return out;
}
