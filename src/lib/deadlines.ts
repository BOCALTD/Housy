// Deadline classification for reminders and the compliance calendar (master prompt Section 13.4).

export type DeadlineState = "ESCALATED" | "OVERDUE" | "DUE_SOON" | "LATER";

const DAY_MS = 86_400_000;

/**
 * Where a deadline stands today. A deadline is "due soon" from `leadDays` before it, through the day
 * it falls due. Once it has passed it is overdue, and after `escalationDays` more days it is escalated.
 */
export function classifyDeadline(due: Date, today: Date, leadDays: number, escalationDays: number) {
  const days = Math.round((due.getTime() - today.getTime()) / DAY_MS);
  let state: DeadlineState = "LATER";
  if (days < 0) state = -days >= escalationDays ? "ESCALATED" : "OVERDUE";
  else if (days <= leadDays) state = "DUE_SOON";
  return { state, days };
}

export const STATE_ORDER: Record<DeadlineState, number> = { ESCALATED: 0, OVERDUE: 1, DUE_SOON: 2, LATER: 3 };
