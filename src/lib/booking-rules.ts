/**
 * Inspection scheduling and inspection safety (master prompt §29), and Trust and Safety cases (§40). Pure rules, tested on their own.
 */

// ---------- Inspection bookings ----------
export const BOOKING_STATUSES = ["REQUESTED", "CONFIRMED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "RESCHEDULED"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export const BOOKING_LABEL: Record<BookingStatus, string> = {
  REQUESTED: "Requested", CONFIRMED: "Confirmed", EN_ROUTE: "On the way", ARRIVED: "Arrived", IN_PROGRESS: "Inspection in progress",
  COMPLETED: "Completed", CANCELLED: "Cancelled", RESCHEDULED: "Rescheduled",
};
/** RESCHEDULED is a step, not an end: a rescheduled booking goes back to CONFIRMED at the new time (the event history keeps the old one). */
const NEXT: Record<BookingStatus, BookingStatus[]> = {
  REQUESTED: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["EN_ROUTE", "ARRIVED", "RESCHEDULED", "CANCELLED"],
  RESCHEDULED: ["CONFIRMED", "CANCELLED"],
  EN_ROUTE: ["ARRIVED", "CANCELLED"],
  ARRIVED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED"],
  COMPLETED: [], CANCELLED: [],
};
export type Actor = "COMPANY" | "REQUESTER";
/** What each side may do. The requester can only cancel (or ask to reschedule, which the company then sets). */
export function canMove(from: BookingStatus, to: BookingStatus, by: Actor) {
  if (!NEXT[from].includes(to)) return false;
  if (by === "REQUESTER") return to === "CANCELLED" && ["REQUESTED", "CONFIRMED", "RESCHEDULED"].includes(from);
  return true;
}
export const nextSteps = (from: BookingStatus, by: Actor) => NEXT[from].filter((to) => canMove(from, to, by));
export const isOpen = (s: BookingStatus) => !["COMPLETED", "CANCELLED"].includes(s);

export const BOOKING_MIN_LEAD_MINUTES = 60;
export const BOOKING_MAX_DAYS_AHEAD = 90;
export const DURATIONS = [30, 45, 60, 90, 120] as const;

/** Two time windows overlap (end is exclusive), allowing a gap for travel between inspections. */
export function overlaps(a: { start: Date; minutes: number }, b: { start: Date; minutes: number }, gapMinutes = 15) {
  const as = a.start.getTime(), ae = as + (a.minutes + gapMinutes) * 60_000;
  const bs = b.start.getTime(), be = bs + (b.minutes + gapMinutes) * 60_000;
  return as < be && bs < ae;
}

/** A time someone asks for must be in the future (with a little notice) and not too far ahead. */
export function checkRequestedTime(at: Date, now = new Date()): string | null {
  if (Number.isNaN(at.getTime())) return "Choose a date and time";
  if (at.getTime() < now.getTime() + BOOKING_MIN_LEAD_MINUTES * 60_000) return "Choose a time at least an hour from now";
  if (at.getTime() > now.getTime() + BOOKING_MAX_DAYS_AHEAD * 864e5) return `Choose a time within the next ${BOOKING_MAX_DAYS_AHEAD} days`;
  return null;
}

/** Remind both sides once, about a day before (bookings starting between 1 and 26 hours from now that have not been reminded). */
export function dueForReminder(b: { status: BookingStatus; scheduledAt: Date | null; remindedAt: Date | null }, now = new Date()) {
  if (b.status !== "CONFIRMED" || !b.scheduledAt || b.remindedAt) return false;
  const h = (b.scheduledAt.getTime() - now.getTime()) / 3_600_000;
  return h > 1 && h <= 26;
}

// ---------- Safety sessions ----------
export const SAFETY_CONSENT_VERSION = "2026-10-v1";
export const SAFETY_CONSENT_TEXT = "While this safety session is on, your location is shared every minute with the company's managers for this inspection and with your trusted contact if you add one. It is only shared while this page is open and the session is on. It stops when you check out, when you press Stop, or automatically two hours after the expected end. Location points are deleted 30 days after the session ends. You can stop at any time.";
export const AUTO_STOP_GRACE_MINUTES = 120;
export const PING_RETENTION_DAYS = 30;
export const MIN_PING_SECONDS = 20;
export const EMERGENCY_NUMBERS = [{ label: "Emergency (Nigeria)", number: "112" }, { label: "Lagos State emergency", number: "767" }];

export function sessionLive(s: { endedAt: Date | null; expectedEndAt: Date }, now = new Date()) {
  return !s.endedAt && now.getTime() <= s.expectedEndAt.getTime() + AUTO_STOP_GRACE_MINUTES * 60_000;
}
export function checkPing(p: { lat: number; lng: number; accuracy?: number | null }): string | null {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) return "Location is not valid";
  if (p.accuracy != null && (!Number.isFinite(p.accuracy) || p.accuracy < 0 || p.accuracy > 100_000)) return "Accuracy is not valid";
  return null;
}
export function checkExpectedMinutes(m: number): string | null {
  return Number.isInteger(m) && m >= 15 && m <= 480 ? null : "Choose how long the inspection should take (15 minutes to 8 hours)";
}

// ---------- Trust and Safety cases ----------
export const CASE_CATEGORIES = {
  SUSPICIOUS_LISTING: "Suspicious or fake listing", FRAUD: "Fraud or a scam attempt", IDENTITY: "Someone is not who they claim",
  REVIEW_DISPUTE: "A review I disagree with", INSPECTION_SAFETY: "Safety at an inspection", HARASSMENT: "Harassment or abuse",
  VACANCY_REPORT: "A vacancy report concern", UNAUTHORISED_CONTENT: "Content used without permission", COLLABORATION: "A collaboration dispute",
  SECURITY_INCIDENT: "Security incident (account, data)", APPEAL: "Appeal a moderation decision", OTHER: "Something else",
} as const;
export type CaseCategory = keyof typeof CASE_CATEGORIES;
export const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const CASE_STATUSES = ["OPEN", "INVESTIGATING", "WAITING_INFO", "ACTION_TAKEN", "CLOSED_NO_ACTION"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];
export const CASE_STATUS_LABEL: Record<CaseStatus, string> = { OPEN: "Received", INVESTIGATING: "Being investigated", WAITING_INFO: "Waiting for more information", ACTION_TAKEN: "Closed: action taken", CLOSED_NO_ACTION: "Closed: no action needed" };
const HOURS: Record<Severity, number> = { CRITICAL: 24, HIGH: 72, MEDIUM: 168, LOW: 336 };

/** The starting severity from the category; a reviewer can change it. */
export function defaultSeverity(c: CaseCategory): Severity {
  if (c === "INSPECTION_SAFETY" || c === "SECURITY_INCIDENT") return "HIGH";
  if (c === "FRAUD" || c === "IDENTITY" || c === "HARASSMENT") return "HIGH";
  if (c === "SUSPICIOUS_LISTING" || c === "UNAUTHORISED_CONTENT" || c === "APPEAL") return "MEDIUM";
  return "LOW";
}
export function deadlineFor(sev: Severity, from: Date) { return new Date(from.getTime() + HOURS[sev] * 3_600_000); }
export const isClosed = (s: CaseStatus) => s === "ACTION_TAKEN" || s === "CLOSED_NO_ACTION";
export function overdue(c: { status: CaseStatus; dueAt: Date }, now = new Date()) { return !isClosed(c.status) && c.dueAt.getTime() < now.getTime(); }
