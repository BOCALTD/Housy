import { z } from "zod";
import { withInviteToken, withTenant, withUser } from "../db";
import { logActivity } from "../audit";
import { hashToken, newToken } from "../tokens";
import { formatDateTime } from "../dates";
import { AUTO_STOP_GRACE_MINUTES, MIN_PING_SECONDS, PING_RETENTION_DAYS, SAFETY_CONSENT_VERSION, checkExpectedMinutes, checkPing, sessionLive } from "../booking-rules";
import { notify } from "./notifications";
import { system } from "./rewards";
import { bookingDesk } from "./inspection-bookings";
import { openCase } from "./trust-cases";

const startSchema = z.object({
  expectedMinutes: z.coerce.number().int(),
  consent: z.literal(true, { error: "Tick the box to agree to share your location during this session" }),
  trustedName: z.string().trim().max(120).default(""),
  trustedPhone: z.string().trim().max(30).default(""),
  trustedEmail: z.string().trim().max(160).default(""),
});

/**
 * Start a safety session for an inspection. Only the person who asked for the inspection, or someone from the company handling it,
 * can start one, and only with consent. The company's managers can see it only when the person attends for that company.
 */
export async function startSafetySession(userId: string, bookingRef: string, input: z.input<typeof startSchema>, now = new Date()) {
  const d = startSchema.parse(input);
  const e = checkExpectedMinutes(d.expectedMinutes); if (e) throw new Error(e);
  if (d.trustedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.trustedEmail)) throw new Error("Enter a valid email for your trusted contact, or leave it empty");
  // Find the booking either as the person who asked, or as a member of the company handling it.
  const asRequester = await withUser(userId, (tx) => tx.inspectionBooking.findFirst({ where: { ref: bookingRef, requesterId: userId } }));
  let booking = asRequester, forCompany: string | null = null;
  if (!booking) {
    const memberships = await withUser(userId, (tx) => tx.membership.findMany({ where: { userId, status: "ACTIVE" }, select: { companyId: true } }));
    for (const m of memberships) {
      const b = await withTenant(m.companyId, userId, (tx) => tx.inspectionBooking.findFirst({ where: { ref: bookingRef, companyId: m.companyId } }));
      if (b) { booking = b; forCompany = m.companyId; break; }
    }
  }
  if (!booking) throw new Error("Booking not found");
  if (!["CONFIRMED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS"].includes(booking.status)) throw new Error("A safety session can start once the inspection is confirmed, and ends with it");
  const token = d.trustedName || d.trustedPhone || d.trustedEmail ? newToken(24) : null;
  const created = await withUser(userId, async (tx) => {
    const live = await tx.safetySession.findMany({ where: { userId, endedAt: null } });
    for (const s of live) if (sessionLive(s, now)) throw new Error("You already have a safety session on. Stop it first.");
    const s = await tx.safetySession.create({ data: {
      bookingId: booking!.id, userId, companyId: forCompany, shareTokenHash: token ? hashToken(token) : null,
      trustedName: d.trustedName, trustedPhone: d.trustedPhone, trustedEmail: d.trustedEmail,
      consentVersion: SAFETY_CONSENT_VERSION, consentAt: now, startedAt: now, expectedEndAt: new Date(now.getTime() + d.expectedMinutes * 60_000),
    } });
    return s;
  });
  await system((tx) => logActivity(tx, { companyId: forCompany, actorId: userId, entityType: "safety_session", entityId: created.id, action: "safety.started", detail: { booking: bookingRef, consent: SAFETY_CONSENT_VERSION } }));
  return { id: created.id, shareToken: token };
}

async function ownLive(userId: string, sessionId: string, now: Date) {
  const s = await withUser(userId, (tx) => tx.safetySession.findFirst({ where: { id: sessionId, userId } }));
  if (!s) throw new Error("Session not found");
  if (!sessionLive(s, now)) {
    if (!s.endedAt) await withUser(userId, (tx) => tx.safetySession.update({ where: { id: s.id }, data: { endedAt: now, endReason: "AUTO_STOPPED" } }));
    throw new Error("This safety session has ended");
  }
  return s;
}

/** Record a location point. Refused when the session is not on, so location is never taken outside a session. */
export async function recordPing(userId: string, sessionId: string, p: { lat: number; lng: number; accuracy?: number | null }, now = new Date()) {
  const bad = checkPing(p); if (bad) throw new Error(bad);
  const s = await ownLive(userId, sessionId, now);
  if (s.lastAt && now.getTime() - s.lastAt.getTime() < MIN_PING_SECONDS * 1000) return { stored: false };
  await withUser(userId, async (tx) => {
    await tx.safetyPing.create({ data: { sessionId: s.id, userId, companyId: s.companyId, lat: p.lat, lng: p.lng, accuracy: p.accuracy ?? null, at: now } });
    await tx.safetySession.update({ where: { id: s.id }, data: { lastLat: p.lat, lastLng: p.lng, lastAt: now } });
  });
  return { stored: true };
}

export async function checkIn(userId: string, sessionId: string, now = new Date()) {
  const s = await ownLive(userId, sessionId, now);
  await withUser(userId, (tx) => tx.safetySession.update({ where: { id: s.id }, data: { checkedInAt: s.checkedInAt ?? now } }));
}

/** Check out (all is well) or stop: either way location sharing ends now. */
export async function endSession(userId: string, sessionId: string, how: "CHECKED_OUT" | "STOPPED", now = new Date()) {
  const s = await withUser(userId, (tx) => tx.safetySession.findFirst({ where: { id: sessionId, userId } }));
  if (!s) throw new Error("Session not found");
  if (s.endedAt) return;
  await withUser(userId, (tx) => tx.safetySession.update({ where: { id: s.id }, data: { endedAt: now, endReason: how, checkedOutAt: how === "CHECKED_OUT" ? now : null } }));
  if (s.emergencyAt) await system((tx) => logActivity(tx, { companyId: s.companyId, actorId: userId, entityType: "safety_session", entityId: s.id, action: "safety.ended_after_alert", detail: { how } }));
}

/**
 * Raise an emergency. The company's managers (when the person attends for the company) and platform administrators are told at once,
 * and a critical Trust and Safety case is opened. The person is shown the emergency numbers to call.
 */
export async function raiseEmergency(userId: string, sessionId: string, note: string, now = new Date()) {
  const s = await withUser(userId, (tx) => tx.safetySession.findFirst({ where: { id: sessionId, userId } }));
  if (!s) throw new Error("Session not found");
  const msg = note.trim().slice(0, 500);
  await withUser(userId, (tx) => tx.safetySession.update({ where: { id: s.id }, data: { emergencyAt: s.emergencyAt ?? now, emergencyNote: msg } }));
  const where = s.lastLat != null ? ` Last location ${s.lastLat.toFixed(5)}, ${s.lastLng!.toFixed(5)} at ${formatDateTime(s.lastAt!)}.` : " No location has been shared yet.";
  const ref = await openCase(userId, { category: "INSPECTION_SAFETY", targetKind: "BOOKING", targetRef: s.bookingId, description: `EMERGENCY raised during an inspection safety session.${where} ${msg}`.trim() }, [], { severity: "CRITICAL" });
  const desk = s.companyId ? await bookingDesk(s.companyId) : [];
  await system(async (tx) => {
    const admins = await tx.user.findMany({ where: { isPlatformAdmin: true }, select: { id: true } });
    for (const u of [...new Set([...desk, ...admins.map((a) => a.id)])]) {
      if (u === userId) continue;
      await notify(tx, u, { kind: "security.safety_emergency", title: "Emergency alert during an inspection", body: `${msg || "No message."}${where}`, link: s.companyId && desk.includes(u) ? `/app/safety/${s.id}` : `/admin/cases/${ref}` });
    }
    await logActivity(tx, { companyId: s.companyId, actorId: userId, entityType: "safety_session", entityId: s.id, action: "safety.emergency", detail: { case: ref } });
  });
  return ref;
}

export async function ownSession(userId: string, sessionId: string) {
  return withUser(userId, async (tx) => {
    const s = await tx.safetySession.findFirst({ where: { id: sessionId, userId } });
    if (!s) return null;
    const pings = await tx.safetyPing.count({ where: { sessionId: s.id } });
    return { ...s, pings };
  });
}

export async function ownSessionsForBooking(userId: string, bookingId: string) {
  return withUser(userId, (tx) => tx.safetySession.findMany({ where: { userId, bookingId }, orderBy: { startedAt: "desc" }, take: 5 }));
}

/** A company manager looking at a session of someone attending for the company. */
export async function companySession(ctx: { companyId: string; userId: string }, sessionId: string) {
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const s = await tx.safetySession.findFirst({ where: { id: sessionId, companyId: ctx.companyId } });
    if (!s) return null;
    const pings = await tx.safetyPing.findMany({ where: { sessionId: s.id }, orderBy: { at: "desc" }, take: 20 });
    const person = await tx.membership.findFirst({ where: { companyId: ctx.companyId, userId: s.userId }, select: { user: { select: { name: true } } } });
    return { ...s, pings, personName: person?.user.name ?? "Team member" };
  });
}

/** What a trusted contact sees with the private link: status and the latest location while the session is on. Nothing after it ends. */
export async function trustedView(token: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const s = await withInviteToken(hashToken(token), (tx) => tx.safetySession.findFirst({ where: { shareTokenHash: hashToken(token) } }));
  if (!s) return null;
  const live = sessionLive(s, now);
  return {
    live, startedAt: s.startedAt, expectedEndAt: s.expectedEndAt, checkedInAt: s.checkedInAt, endedAt: s.endedAt, endReason: s.endReason, emergencyAt: s.emergencyAt,
    emergencyNote: s.emergencyNote, trustedName: s.trustedName,
    last: live && s.lastLat != null ? { lat: s.lastLat, lng: s.lastLng!, at: s.lastAt! } : null,
  };
}

/** Run on the schedule: stop sessions that ran past their expected end, and delete old location points. */
export async function safetyHousekeeping(now = new Date()) {
  return system(async (tx) => {
    const stopped = await tx.safetySession.updateMany({ where: { endedAt: null, expectedEndAt: { lt: new Date(now.getTime() - AUTO_STOP_GRACE_MINUTES * 60_000) } }, data: { endedAt: now, endReason: "AUTO_STOPPED" } });
    const old = await tx.safetySession.findMany({ where: { endedAt: { lt: new Date(now.getTime() - PING_RETENTION_DAYS * 864e5) } }, select: { id: true } });
    const removed = old.length ? await tx.safetyPing.deleteMany({ where: { sessionId: { in: old.map((o) => o.id) } } }) : { count: 0 };
    return { autoStopped: stopped.count, pingsDeleted: removed.count };
  });
}
