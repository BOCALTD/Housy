// Correspondence workflow rules (master prompt Section 11.2). Pure functions, unit-tested.

export type CorrStatus =
  | "REGISTERED" | "ASSIGNED" | "UNDER_REVIEW" | "RESPONSE_REQUIRED" | "DRAFT_RESPONSE"
  | "AWAITING_APPROVAL" | "APPROVED" | "SENT" | "AWAITING_REPLY" | "CLOSED";

export type CorrAction =
  | "assign" | "start_review" | "require_response" | "save_draft" | "submit_for_approval"
  | "approve" | "return_to_draft" | "dispatch" | "await_reply" | "close";

/** Which statuses each action may start from, and where it leads. */
const RULES: Record<CorrAction, { from: CorrStatus[]; to: CorrStatus }> = {
  assign: { from: ["REGISTERED", "ASSIGNED", "UNDER_REVIEW", "RESPONSE_REQUIRED", "DRAFT_RESPONSE"], to: "ASSIGNED" },
  start_review: { from: ["ASSIGNED"], to: "UNDER_REVIEW" },
  require_response: { from: ["UNDER_REVIEW"], to: "RESPONSE_REQUIRED" },
  save_draft: { from: ["RESPONSE_REQUIRED", "DRAFT_RESPONSE"], to: "DRAFT_RESPONSE" },
  submit_for_approval: { from: ["DRAFT_RESPONSE"], to: "AWAITING_APPROVAL" },
  approve: { from: ["AWAITING_APPROVAL"], to: "APPROVED" },
  return_to_draft: { from: ["AWAITING_APPROVAL"], to: "DRAFT_RESPONSE" },
  dispatch: { from: ["APPROVED"], to: "SENT" },
  await_reply: { from: ["SENT"], to: "AWAITING_REPLY" },
  close: { from: ["REGISTERED", "ASSIGNED", "UNDER_REVIEW", "RESPONSE_REQUIRED", "DRAFT_RESPONSE", "APPROVED", "SENT", "AWAITING_REPLY"], to: "CLOSED" },
};

export const STATUS_LABELS: Record<CorrStatus, string> = {
  REGISTERED: "Registered",
  ASSIGNED: "Assigned",
  UNDER_REVIEW: "Under review",
  RESPONSE_REQUIRED: "Response required",
  DRAFT_RESPONSE: "Draft response",
  AWAITING_APPROVAL: "Awaiting approval",
  APPROVED: "Approved",
  SENT: "Sent or dispatched",
  AWAITING_REPLY: "Awaiting reply",
  CLOSED: "Closed",
};

export function nextStatus(action: CorrAction, from: CorrStatus): CorrStatus {
  const rule = RULES[action];
  if (!rule.from.includes(from)) {
    throw new Error(`A record that is "${STATUS_LABELS[from].toLowerCase()}" cannot be moved that way.`);
  }
  return rule.to;
}

export function allowedActions(from: CorrStatus): CorrAction[] {
  return (Object.keys(RULES) as CorrAction[]).filter((a) => RULES[a].from.includes(from));
}

/** Statuses where the company still owes a response, so a passed deadline counts as overdue. */
export const OPEN_FOR_RESPONSE: CorrStatus[] = [
  "REGISTERED", "ASSIGNED", "UNDER_REVIEW", "RESPONSE_REQUIRED", "DRAFT_RESPONSE", "AWAITING_APPROVAL", "APPROVED",
];

export function isOverdue(status: CorrStatus, deadline: Date | null, today: Date): boolean {
  return !!deadline && deadline < today && OPEN_FOR_RESPONSE.includes(status);
}

/**
 * Reference number: PREFIX/DEPT/YEAR/SEQUENCE, for example ALP/LEG/2026/0007.
 * The department part is left out when no department is set: ALP/2026/0007.
 */
export function formatReference(prefix: string, departmentCode: string | null, year: number, sequence: number): string {
  const parts = [cleanCode(prefix) || "REF"];
  if (departmentCode) parts.push(cleanCode(departmentCode));
  parts.push(String(year), String(sequence).padStart(4, "0"));
  return parts.join("/");
}

/** Codes are short, upper-case letters and digits. */
export function cleanCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}
