// Inspection calendars: a single event to download, and a private feed link that calendar apps subscribe to.
import { withApiToken, withTenant, withUser } from "../db";
import { hashToken, newToken } from "../tokens";
import { can, type Role } from "../permissions";
import { icsCalendar, type IcsEvent } from "../ics";
import { bookingEvent } from "../inspection-calendar";
import { companyBooking, myBooking } from "./inspection-bookings";
import type { Ctx } from "./context";

const PAST_DAYS = 30;
const AHEAD_DAYS = 180;

export async function bookingIcsForRequester(userId: string, ref: string, origin: string) {
  const b = await myBooking(userId, ref);
  if (!b) return null;
  const e = bookingEvent(b, b.listing, "REQUESTER", { origin, meetingWith: b.agent?.displayName ?? null });
  return e ? { ics: icsCalendar("Inspection", [e]), ref: b.ref } : null;
}

export async function bookingIcsForCompany(ctx: Ctx, id: string, origin: string) {
  const b = await companyBooking(ctx, id);
  if (!b) return null;
  const e = bookingEvent(b, b.listing, "STAFF", { origin });
  return e ? { ics: icsCalendar("Inspection", [e]), ref: b.ref } : null;
}

export async function feedStatus(userId: string) {
  return withUser(userId, (tx) => tx.calendarFeed.findUnique({ where: { userId }, select: { createdAt: true } }));
}

/** Make (or replace) the person's feed link. The old link stops working. Returns the secret once. */
export async function makeFeed(userId: string) {
  const token = newToken(24);
  await withUser(userId, async (tx) => {
    await tx.calendarFeed.deleteMany({ where: { userId } });
    await tx.calendarFeed.create({ data: { userId, tokenHash: hashToken(token) } });
  });
  return token;
}

export async function removeFeed(userId: string) {
  await withUser(userId, (tx) => tx.calendarFeed.deleteMany({ where: { userId } }));
}

/** Everything a person should see in their calendar: inspections they asked for, and ones they are meeting people at for a company. */
export async function feedEvents(userId: string, origin: string, now = new Date()): Promise<IcsEvent[]> {
  const from = new Date(now.getTime() - PAST_DAYS * 864e5), to = new Date(now.getTime() + AHEAD_DAYS * 864e5);
  const window = { scheduledAt: { gte: from, lte: to } };
  const events: IcsEvent[] = [];

  const asked = await withUser(userId, async (tx) => {
    const rows = await tx.inspectionBooking.findMany({ where: { requesterId: userId, ...window }, orderBy: { scheduledAt: "asc" }, take: 200 });
    const listings = await tx.listing.findMany({ where: { id: { in: rows.map((r) => r.listingId) } }, select: { id: true, title: true, city: true, state: true } });
    const agents = await tx.agentProfile.findMany({ where: { userId: { in: rows.map((r) => r.assignedUserId).filter((x): x is string => !!x) }, listed: true }, select: { userId: true, displayName: true } });
    return rows.map((r) => ({ r, l: listings.find((l) => l.id === r.listingId) ?? null, agent: agents.find((a) => a.userId === r.assignedUserId)?.displayName ?? null }));
  });
  for (const { r, l, agent } of asked) { const e = bookingEvent(r, l, "REQUESTER", { origin, meetingWith: agent }); if (e) events.push(e); }

  // Companies where the person is an active member who handles bookings, and which are not suspended.
  const memberships = await withUser(userId, (tx) => tx.membership.findMany({ where: { userId, status: "ACTIVE" }, select: { companyId: true, role: true, company: { select: { suspendedAt: true } } } }));
  for (const m of memberships) {
    if (m.company.suspendedAt || !can(m.role as Role, "booking.manage")) continue;
    const rows = await withTenant(m.companyId, userId, async (tx) => {
      const rows = await tx.inspectionBooking.findMany({ where: { companyId: m.companyId, assignedUserId: userId, ...window }, orderBy: { scheduledAt: "asc" }, take: 300 });
      const listings = await tx.listing.findMany({ where: { companyId: m.companyId, id: { in: rows.map((r) => r.listingId) } }, select: { id: true, title: true, city: true, state: true } });
      return rows.map((r) => ({ r, l: listings.find((l) => l.id === r.listingId) ?? null }));
    });
    for (const { r, l } of rows) { const e = bookingEvent(r, l, "STAFF", { origin }); if (e) events.push(e); }
  }
  return events.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** The feed for a presented link secret, or null if the link is unknown or was replaced. */
export async function feedByToken(token: string, origin: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const tokenHash = hashToken(token);
  const feed = await withApiToken(tokenHash, (tx) => tx.calendarFeed.findUnique({ where: { tokenHash }, select: { userId: true } }));
  if (!feed) return null;
  return icsCalendar("Housy inspections", await feedEvents(feed.userId, origin, now), now);
}
