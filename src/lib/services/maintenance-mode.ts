/**
 * Upgrade and maintenance mode, set by the platform administrator in Admin → Settings. See maintenance-rules.ts for the rules.
 * The window is kept in platform settings; the 24-hour notice goes to every active account in the app and by email, in batches
 * from the notifications job (every 10 minutes), so a large audience never holds up one run.
 */
import { prisma } from "../db";
import { system } from "./rewards";
import { logActivity } from "../audit";
import { formatDateTime, fromLagosLocal } from "../dates";
import { dedupeKeyFor } from "../notification-rules";
import { NOTICE_HOURS, noticeDue, phaseOf, windowProblem, type MaintenanceWindow } from "../site-maintenance-rules";

const K = { start: "maintenance_start", end: "maintenance_end", message: "maintenance_message", notified: "maintenance_notified_at", emergency: "maintenance_emergency", cursor: "maintenance_notice_cursor" } as const;
const KIND = "system.maintenance";

let cache: { at: number; value: MaintenanceWindow | null } | null = null;
export function forgetMaintenance() { cache = null; }

/** The current or next window, cached for 15 seconds (it is read on every page). Null when none is set. */
export async function maintenanceWindow(): Promise<MaintenanceWindow | null> {
  if (cache && Date.now() - cache.at < 15_000) return cache.value;
  const rows = await prisma.platformSetting.findMany({ where: { key: { in: [K.start, K.end, K.message, K.notified, K.emergency] } } });
  const v = (k: string) => rows.find((r) => r.key === k)?.value ?? "";
  const start = new Date(v(K.start)), end = new Date(v(K.end));
  const value = Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end.getTime() <= Date.now() ? null
    : { start, end, message: v(K.message), notifiedAt: v(K.notified) ? new Date(v(K.notified)) : null, emergency: v(K.emergency) === "1" };
  cache = { at: Date.now(), value };
  return value;
}

export async function maintenanceNow(now = new Date()) {
  const w = await maintenanceWindow();
  return { window: w, phase: phaseOf(w, now) };
}

async function assertAdmin(adminId: string) {
  const u = await prisma.user.findUnique({ where: { id: adminId }, select: { isPlatformAdmin: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that.");
}

async function put(adminId: string, entries: [string, string | null][]) {
  await system(async (tx) => {
    for (const [key, value] of entries) {
      if (value === null) await tx.platformSetting.deleteMany({ where: { key } });
      else await tx.platformSetting.upsert({ where: { key }, create: { key, value, updatedById: adminId }, update: { value, updatedById: adminId } });
    }
  });
  forgetMaintenance();
}

/** Schedule an upgrade or maintenance window (times as typed, in the administrator's time zone). Replaces any window not yet started. */
export async function scheduleMaintenance(adminId: string, input: { start: string; end: string; message: string; emergency: boolean }, now = new Date()) {
  await assertAdmin(adminId);
  const current = await maintenanceNow(now);
  if (current.phase === "active") throw new Error("Maintenance is on now. End it first, then schedule the next one.");
  const start = fromLagosLocal(input.start), end = fromLagosLocal(input.end);
  const bad = windowProblem(start, end, now, input.emergency);
  if (bad) throw new Error(bad);
  const message = input.message.trim().slice(0, 500);
  // A changed window is announced again (the earlier notice had other times).
  await put(adminId, [[K.start, start.toISOString()], [K.end, end.toISOString()], [K.message, message], [K.emergency, input.emergency ? "1" : "0"], [K.notified, null], [K.cursor, null]]);
  await system((tx) => logActivity(tx, { companyId: null, actorId: adminId, entityType: "settings", entityId: "maintenance", action: "settings.maintenance_scheduled", detail: { start: start.toISOString(), end: end.toISOString(), emergency: input.emergency } }));
  // An emergency is announced at once; any other window 24 hours before it starts, by the notifications job.
  if (input.emergency) await sendMaintenanceNotice(now);
  return { start, end };
}

/** Cancel a window that has not started, or end one early. If people were told, they are told it is off (in the app only). */
export async function endMaintenance(adminId: string, now = new Date()) {
  await assertAdmin(adminId);
  const { window: w, phase } = await maintenanceNow(now);
  if (!w) throw new Error("No maintenance is scheduled.");
  await put(adminId, [[K.start, null], [K.end, null], [K.message, null], [K.emergency, null], [K.notified, null], [K.cursor, null]]);
  await system((tx) => logActivity(tx, { companyId: null, actorId: adminId, entityType: "settings", entityId: "maintenance", action: phase === "active" ? "settings.maintenance_ended" : "settings.maintenance_cancelled", detail: { start: w.start.toISOString() } }));
  if (w.notifiedAt && phase !== "active") await broadcast({ title: "Planned maintenance cancelled", body: `The maintenance planned for ${formatDateTime(w.start)} will not happen. Housy stays open as usual.`, email: false });
  return phase === "active" ? "ended" : "cancelled";
}

/** In the app (and by email unless told not to), to every active account. Batches of 1000; returns how many were reached. */
async function broadcast(n: { title: string; body: string; email: boolean }, after = "", maxBatches = 20) {
  let cursor = after, reached = 0;
  for (let i = 0; i < maxBatches; i++) {
    const users = await prisma.user.findMany({ where: { id: { gt: cursor }, removedAt: null, suspendedAt: null }, orderBy: { id: "asc" }, take: 1000, select: { id: true } });
    if (!users.length) return { reached, cursor, done: true };
    const now = new Date();
    await system(async (tx) => {
      await tx.notification.createMany({ data: users.map((u) => ({ userId: u.id, kind: KIND, title: n.title, body: n.body, link: "" })) });
      if (n.email) await tx.emailOutbox.createMany({ data: users.map((u) => ({ userId: u.id, kind: KIND, category: "ESSENTIAL", template: "generic", vars: { title: n.title, body: n.body, link: "" } as never, dedupeKey: dedupeKeyFor(u.id, KIND, n.title, now) })), skipDuplicates: true });
    });
    reached += users.length;
    cursor = users[users.length - 1].id;
    if (users.length < 1000) return { reached, cursor, done: true };
  }
  return { reached, cursor, done: false };
}

/** Run from the notifications job: sends the 24-hour notice once, continuing where the last run stopped for a large audience. */
export async function sendMaintenanceNotice(now = new Date()) {
  const w = await maintenanceWindow();
  if (!w) return { sent: 0 };
  const cursorRow = await prisma.platformSetting.findUnique({ where: { key: K.cursor } });
  if (!noticeDue(w, now) && !cursorRow) return { sent: 0 };
  const hours = Math.max(1, Math.round((w.start.getTime() - now.getTime()) / 3_600_000));
  const when = `from ${formatDateTime(w.start)} to ${formatDateTime(w.end)} (Lagos time, WAT, UTC+1)`;
  const body = `${w.start.getTime() <= now.getTime() ? "Housy is being upgraded now" : `Housy will be closed for an upgrade ${when}`}${w.start.getTime() > now.getTime() && hours < NOTICE_HOURS ? `, in about ${hours} hour${hours === 1 ? "" : "s"}` : ""}. ${w.message ? `${w.message} ` : ""}During that time you will not be able to sign in or use the site. Payments made just before are safe and are confirmed when it reopens.`;
  const r = await broadcast({ title: `Planned maintenance on ${formatDateTime(w.start)}`, body: body.slice(0, 600), email: true }, cursorRow?.value ?? "");
  await put("system", r.done ? [[K.notified, now.toISOString()], [K.cursor, null]] : [[K.cursor, r.cursor]]);
  return { sent: r.reached, done: r.done };
}
