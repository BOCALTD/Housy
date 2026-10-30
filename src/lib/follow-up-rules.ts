/**
 * Suggested follow-ups (master prompt §37: suggest follow-up tasks): open leads that have gone quiet, worked out from the
 * company's own contact history. A suggestion only; the agent decides whether to plan a follow-up. Pure, tested on its own.
 */
export const QUIET_DAYS = 14;
export const FAST_QUIET_DAYS = 7;

export type QuietInput = { status: string; timeline: string; createdAt: Date; lastContactAt: Date | null; openFollowUp: boolean };
export type Quiet = { level: "high" | "medium"; reason: string; days: number };

const daysSince = (d: Date, now: Date) => Math.floor((now.getTime() - d.getTime()) / 864e5);

export function quietReason(l: QuietInput, now = new Date()): Quiet | null {
  if (l.openFollowUp || !["NEW", "CONTACTED", "QUALIFIED"].includes(l.status)) return null;
  if (!l.lastContactAt) {
    const d = daysSince(l.createdAt, now);
    if (d < 1) return null;
    return { level: d >= 3 ? "high" : "medium", days: d, reason: `Not contacted yet, ${d} day${d === 1 ? "" : "s"} after the lead came in.` };
  }
  const d = daysSince(l.lastContactAt, now);
  if (l.timeline === "IMMEDIATE" && d >= FAST_QUIET_DAYS) return { level: "high", days: d, reason: `Wants to move now, but no contact for ${d} days.` };
  if (d >= QUIET_DAYS) return { level: l.status === "QUALIFIED" ? "high" : "medium", days: d, reason: `No contact for ${d} days${l.status === "QUALIFIED" ? " on a qualified lead" : ""}.` };
  return null;
}

export const CONTACT_KINDS = ["CALL", "EMAIL", "MEETING", "WHATSAPP"] as const;
