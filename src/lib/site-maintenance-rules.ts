/**
 * Upgrade and maintenance windows (pure rules, tested on their own). The platform administrator schedules a window at least 24
 * hours ahead; everyone is told in the app and by email 24 hours before it starts; during it, visitors see a "back soon" page while
 * administrators can still sign in and check the site. Payment messages from Paystack, scheduled jobs and the health check keep
 * working throughout, so nothing paid is lost.
 */
export const NOTICE_HOURS = 24;
export const MAX_HOURS = 72;
const H = 3_600_000;

export type MaintenanceWindow = { start: Date; end: Date; message: string; notifiedAt: Date | null; emergency: boolean };
export type MaintenancePhase = "none" | "scheduled" | "notice" | "active" | "over";

/** Where the window stands: scheduled (more than a day away), notice (within a day: tell everyone, show the banner), active, or over. */
export function phaseOf(w: MaintenanceWindow | null, now: Date): MaintenancePhase {
  if (!w) return "none";
  const t = now.getTime();
  if (t >= w.end.getTime()) return "over";
  if (t >= w.start.getTime()) return "active";
  if (t >= w.start.getTime() - NOTICE_HOURS * H) return "notice";
  return "scheduled";
}

/** True when the 24-hour notice should go out now (once). An emergency window is announced as soon as it is set. */
export const noticeDue = (w: MaintenanceWindow | null, now: Date) => !!w && !w.notifiedAt && (w.emergency || ["notice", "active"].includes(phaseOf(w, now)));

/** Checks a window the administrator is setting. An emergency one may start at once; any other needs a full day's notice. */
export function windowProblem(start: Date, end: Date, now: Date, emergency: boolean): string | null {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "Enter when it starts and when it ends.";
  if (end.getTime() <= start.getTime()) return "It must end after it starts.";
  if (end.getTime() - start.getTime() > MAX_HOURS * H) return `A maintenance window can last up to ${MAX_HOURS} hours.`;
  if (emergency) return start.getTime() < now.getTime() - 5 * 60_000 ? "Choose a start time from now on." : null;
  if (start.getTime() < now.getTime() + NOTICE_HOURS * H - 60_000) return "Start it at least 24 hours from now, so everyone can be told in time. For something urgent, tick “Emergency”.";
  return null;
}

/**
 * Pages that stay open during maintenance: administrators' pages and signing in (so they can check the site), the legal pages, the
 * maintenance page itself. Everything under /api (payment messages, scheduled jobs, health) is not affected at all.
 */
export function openDuringMaintenance(path: string): boolean {
  return /^\/(admin|login|auth|legal|api|maintenance)(\/|$|\?)/.test(path) || /^\/(_next|favicon|icon|apple-icon|manifest|robots|sw\.js|health\.js|offline)/.test(path);
}
