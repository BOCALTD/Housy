import { z } from "zod";
import { withTenant, withUser, type Tx } from "../db";
import { logActivity } from "../audit";
import { randomRef } from "../tokens";
import { rateLimit } from "../ratelimit";
import { formatDateTime, fromLagosLocal } from "../dates";
import { BOOKING_LABEL, DURATIONS, canMove, checkRequestedTime, dueForReminder, isOpen, overlaps, type BookingStatus } from "../booking-rules";
import { assertCan, type Ctx } from "./context";
import { notify } from "./notifications";
import { system } from "./rewards";

const requestSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(120),
  phone: z.string().trim().max(30).default(""),
  preferredAt: z.string().transform((v) => fromLagosLocal(v)),
  alternativeAt: z.string().optional().transform((v) => (v ? fromLagosLocal(v) : null)),
  message: z.string().trim().max(1000).default(""),
});

/** The company's people who look after bookings: administrators and managers, plus whoever posted the listing. */
export async function bookingDesk(companyId: string, extra: (string | null)[] = []) {
  const ms = await withTenant(companyId, "system", (tx) => tx.membership.findMany({ where: { companyId, status: "ACTIVE", role: { in: ["COMPANY_SUPER_ADMIN", "MANAGER"] } }, select: { userId: true } }));
  return [...new Set([...ms.map((m) => m.userId), ...extra.filter((x): x is string => !!x)])];
}

/** A signed-in person asks to inspect a published property. The company confirms a time and who will meet them. */
export async function requestInspection(userId: string, publicRef: string, input: z.input<typeof requestSchema>, now = new Date()) {
  const d = requestSchema.parse(input);
  const e1 = checkRequestedTime(d.preferredAt, now); if (e1) throw new Error(e1);
  if (d.alternativeAt) { const e2 = checkRequestedTime(d.alternativeAt, now); if (e2) throw new Error(`Second choice: ${e2.toLowerCase()}`); }
  if (!(await rateLimit(`inspect:${userId}`, 5, 864e5))) throw new Error("You have asked for several inspections today. Try again tomorrow.");
  const made = await withUser(userId, async (tx) => {
    const listing = await tx.listing.findFirst({ where: { publicRef, status: "PUBLISHED" }, select: { id: true, companyId: true, title: true, postedById: true } });
    if (!listing) throw new Error("That property is not available");
    const open = await tx.inspectionBooking.count({ where: { requesterId: userId, listingId: listing.id, status: { in: ["REQUESTED", "CONFIRMED", "RESCHEDULED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS"] } } });
    if (open) throw new Error("You already have an inspection booked for this property. See My inspections.");
    const b = await tx.inspectionBooking.create({ data: { ref: randomRef("INS"), companyId: listing.companyId, listingId: listing.id, requesterId: userId, requesterName: d.name, requesterPhone: d.phone, message: d.message, preferredAt: d.preferredAt, alternativeAt: d.alternativeAt } });
    await tx.inspectionBookingEvent.create({ data: { bookingId: b.id, companyId: b.companyId, requesterId: userId, actorId: userId, fromStatus: "", toStatus: "REQUESTED", note: d.message.slice(0, 500) } });
    return { b, listing };
  });
  await system(async (tx) => {
    for (const u of await bookingDesk(made.b.companyId, [made.listing.postedById])) {
      await notify(tx, u, { kind: "inspection.requested", title: `Inspection requested: ${made.listing.title}`, body: `${d.name} would like ${formatDateTime(d.preferredAt)}${d.alternativeAt ? ` or ${formatDateTime(d.alternativeAt)}` : ""}.`, link: `/app/bookings/${made.b.id}` });
    }
    await logActivity(tx, { companyId: made.b.companyId, actorId: userId, entityType: "inspection_booking", entityId: made.b.id, action: "inspection.requested", detail: { ref: made.b.ref } });
  });
  return made.b.ref;
}

export async function myBookings(userId: string) {
  return withUser(userId, async (tx) => {
    const rows = await tx.inspectionBooking.findMany({ where: { requesterId: userId }, orderBy: { createdAt: "desc" }, take: 50 });
    const listings = await tx.listing.findMany({ where: { id: { in: rows.map((r) => r.listingId) } }, select: { id: true, title: true, publicRef: true, city: true, state: true } });
    return rows.map((r) => ({ ...r, listing: listings.find((l) => l.id === r.listingId) ?? null }));
  });
}

export async function myBooking(userId: string, ref: string) {
  return withUser(userId, async (tx) => {
    const b = await tx.inspectionBooking.findFirst({ where: { ref, requesterId: userId } });
    if (!b) return null;
    const [events, listing, agent] = await Promise.all([
      tx.inspectionBookingEvent.findMany({ where: { bookingId: b.id }, orderBy: { createdAt: "asc" } }),
      tx.listing.findFirst({ where: { id: b.listingId }, select: { title: true, publicRef: true, city: true, state: true } }),
      b.assignedUserId ? tx.agentProfile.findFirst({ where: { userId: b.assignedUserId, listed: true }, select: { displayName: true, userId: true } }) : null,
    ]);
    return { ...b, events, listing, agent };
  });
}

export async function cancelByRequester(userId: string, ref: string, reason: string) {
  const r = reason.trim().slice(0, 500);
  const b = await withUser(userId, async (tx) => {
    const b = await tx.inspectionBooking.findFirst({ where: { ref, requesterId: userId } });
    if (!b) throw new Error("Booking not found");
    if (!canMove(b.status as BookingStatus, "CANCELLED", "REQUESTER")) throw new Error("This inspection can no longer be cancelled here. Message the company instead.");
    await tx.inspectionBooking.update({ where: { id: b.id }, data: { status: "CANCELLED", cancelReason: r || "Cancelled by the person who asked" } });
    await tx.inspectionBookingEvent.create({ data: { bookingId: b.id, companyId: b.companyId, requesterId: userId, actorId: userId, fromStatus: b.status, toStatus: "CANCELLED", note: r } });
    return b;
  });
  await system(async (tx) => { for (const u of await bookingDesk(b.companyId, [b.assignedUserId])) await notify(tx, u, { kind: "inspection.cancelled", title: `Inspection ${b.ref} cancelled`, body: r, link: `/app/bookings/${b.id}` }); });
}

// ---------- Company side ----------

export async function companyBookings(ctx: Ctx, now = new Date()) {
  assertCan(ctx, "booking.manage");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const mine = ctx.role === "AGENT" ? { OR: [{ assignedUserId: ctx.userId }, { assignedUserId: null }] } : {};
    const rows = await tx.inspectionBooking.findMany({ where: { companyId: ctx.companyId, AND: [mine, { OR: [{ status: { in: ["REQUESTED", "CONFIRMED", "RESCHEDULED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS"] } }, { updatedAt: { gte: new Date(now.getTime() - 30 * 864e5) } }] }] }, orderBy: [{ scheduledAt: { sort: "asc", nulls: "first" } }, { preferredAt: "asc" }], take: 300 });
    const listings = await tx.listing.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.listingId))] }, companyId: ctx.companyId }, select: { id: true, title: true, publicRef: true } });
    const people = await tx.membership.findMany({ where: { companyId: ctx.companyId, userId: { in: rows.map((r) => r.assignedUserId).filter((x): x is string => !!x) } }, select: { userId: true, user: { select: { name: true } } } });
    return rows.map((r) => ({ ...r, listing: listings.find((l) => l.id === r.listingId) ?? null, agentName: people.find((p) => p.userId === r.assignedUserId)?.user.name ?? null }));
  });
}

export async function companyBooking(ctx: Ctx, id: string) {
  assertCan(ctx, "booking.manage");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const b = await tx.inspectionBooking.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!b) return null;
    const [events, listing, team, sessions] = await Promise.all([
      tx.inspectionBookingEvent.findMany({ where: { bookingId: b.id }, orderBy: { createdAt: "asc" } }),
      tx.listing.findFirst({ where: { id: b.listingId, companyId: ctx.companyId }, select: { title: true, publicRef: true, city: true, state: true } }),
      tx.membership.findMany({ where: { companyId: ctx.companyId, status: "ACTIVE", role: { in: ["COMPANY_SUPER_ADMIN", "MANAGER", "AGENT"] } }, select: { userId: true, role: true, user: { select: { name: true } } } }),
      tx.safetySession.findMany({ where: { bookingId: b.id, companyId: ctx.companyId }, orderBy: { startedAt: "desc" } }),
    ]);
    return { ...b, events, listing, team: team.map((m) => ({ userId: m.userId, name: m.user.name, role: m.role })), sessions };
  });
}

const confirmSchema = z.object({
  scheduledAt: z.string().transform((v) => fromLagosLocal(v)),
  durationMinutes: z.union([z.string(), z.number()]).transform((v) => Number(v)).refine((n) => (DURATIONS as readonly number[]).includes(n), "Choose how long the inspection takes"),
  assignedUserId: z.string().min(1, "Choose who will meet them"),
  meetingPoint: z.string().trim().max(300).default(""),
  note: z.string().trim().max(500).default(""),
});

async function move(tx: Tx, ctx: Ctx, b: { id: string; companyId: string; requesterId: string; status: string }, to: BookingStatus, data: Record<string, unknown>, note: string) {
  if (!canMove(b.status as BookingStatus, to, "COMPANY")) throw new Error(`A booking that is ${BOOKING_LABEL[b.status as BookingStatus].toLowerCase()} cannot become ${BOOKING_LABEL[to].toLowerCase()}`);
  const done = await tx.inspectionBooking.updateMany({ where: { id: b.id, companyId: ctx.companyId, status: b.status }, data: { ...data, status: to } });
  if (done.count === 0) throw new Error("Someone else changed this booking. Reload and try again.");
  await tx.inspectionBookingEvent.create({ data: { bookingId: b.id, companyId: b.companyId, requesterId: b.requesterId, actorId: ctx.userId, fromStatus: b.status, toStatus: to, note: note.slice(0, 500) } });
  await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "inspection_booking", entityId: b.id, action: `inspection.${to.toLowerCase()}`, detail: { note } });
}

/** Confirm a time and who will meet the person (or set a new time for a rescheduled one). Refuses a time that clashes with that person's other inspections. */
export async function confirmBooking(ctx: Ctx, id: string, input: z.input<typeof confirmSchema>, now = new Date()) {
  assertCan(ctx, "booking.manage");
  const d = confirmSchema.parse(input);
  if (Number.isNaN(d.scheduledAt.getTime()) || d.scheduledAt.getTime() < now.getTime() - 5 * 60_000) throw new Error("Choose a time in the future");
  const out = await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const b = await tx.inspectionBooking.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!b) throw new Error("Booking not found");
    const agent = await tx.membership.findFirst({ where: { companyId: ctx.companyId, userId: d.assignedUserId, status: "ACTIVE" } });
    if (!agent) throw new Error("Choose someone from your company");
    const others = await tx.inspectionBooking.findMany({ where: { companyId: ctx.companyId, assignedUserId: d.assignedUserId, id: { not: b.id }, status: { in: ["CONFIRMED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS"] }, scheduledAt: { not: null } } });
    const clash = others.find((o) => overlaps({ start: d.scheduledAt, minutes: d.durationMinutes }, { start: o.scheduledAt!, minutes: o.durationMinutes }));
    if (clash) throw new Error(`That clashes with inspection ${clash.ref} at ${formatDateTime(clash.scheduledAt!)}. Choose another time or person.`);
    // The exact position of the property goes to the person only now that a time is confirmed, so they can get directions.
    const listing = await tx.listing.findFirst({ where: { id: b.listingId, companyId: ctx.companyId }, select: { assetId: true } });
    const asset = listing ? await tx.asset.findFirst({ where: { id: listing.assetId, companyId: ctx.companyId }, select: { lat: true, lng: true } }) : null;
    const meet = asset && asset.lat !== null && asset.lng !== null ? { meetLat: asset.lat, meetLng: asset.lng } : { meetLat: null, meetLng: null };
    const fields = { scheduledAt: d.scheduledAt, durationMinutes: d.durationMinutes, assignedUserId: d.assignedUserId, meetingPoint: d.meetingPoint, remindedAt: null, ...meet };
    if (b.status === "CONFIRMED") {
      // A new time for a confirmed booking: record it as rescheduled, then confirmed at the new time.
      await move(tx, ctx, b, "RESCHEDULED", {}, `Was ${b.scheduledAt ? formatDateTime(b.scheduledAt) : "unscheduled"}. ${d.note}`.trim());
      await move(tx, ctx, { ...b, status: "RESCHEDULED" }, "CONFIRMED", { ...fields, rescheduleCount: b.rescheduleCount + 1 }, `New time ${formatDateTime(d.scheduledAt)}`);
    } else {
      await move(tx, ctx, b, "CONFIRMED", fields, d.note);
    }
    return { b, rescheduled: b.status === "CONFIRMED" };
  });
  await system(async (tx) => {
    await notify(tx, out.b.requesterId, { kind: "inspection.confirmed", title: out.rescheduled ? `New time for your inspection ${out.b.ref}` : `Inspection ${out.b.ref} confirmed`, body: `${formatDateTime(d.scheduledAt)}${d.meetingPoint ? ` · Meet at: ${d.meetingPoint}` : ""}`, link: `/me/inspections/${out.b.ref}` });
    if (d.assignedUserId !== ctx.userId) await notify(tx, d.assignedUserId, { kind: "inspection.assigned", title: `You are meeting someone for inspection ${out.b.ref}`, body: formatDateTime(d.scheduledAt), link: `/app/bookings/${out.b.id}` });
  });
}

/** Move a booking along: on the way, arrived, in progress, completed or cancelled. */
export async function advanceBooking(ctx: Ctx, id: string, to: BookingStatus, note: string) {
  assertCan(ctx, "booking.manage");
  if (to === "CONFIRMED" || to === "RESCHEDULED") throw new Error("Use the confirm form to set a time");
  if (to === "CANCELLED" && note.trim().length < 3) throw new Error("Say why it is cancelled");
  const b = await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const b = await tx.inspectionBooking.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!b) throw new Error("Booking not found");
    if (ctx.role === "AGENT" && b.assignedUserId !== ctx.userId) throw new Error("Only the person meeting them, or a manager, can update this booking");
    await move(tx, ctx, b, to, to === "CANCELLED" ? { cancelReason: note.trim().slice(0, 500) } : to === "COMPLETED" ? { outcome: note.trim().slice(0, 1000) } : {}, note);
    return b;
  });
  if (["EN_ROUTE", "ARRIVED", "COMPLETED", "CANCELLED"].includes(to)) {
    await system((tx) => notify(tx, b.requesterId, { kind: `inspection.${to.toLowerCase()}`, title: `Inspection ${b.ref}: ${BOOKING_LABEL[to].toLowerCase()}`, body: note.slice(0, 300), link: `/me/inspections/${b.ref}`, email: to === "CANCELLED" }));
  }
}

/** Run on the schedule: remind both sides about a day before. */
export async function inspectionReminders(now = new Date()) {
  return system(async (tx) => {
    const soon = await tx.inspectionBooking.findMany({ where: { status: "CONFIRMED", remindedAt: null, scheduledAt: { gt: new Date(now.getTime() + 3_600_000), lte: new Date(now.getTime() + 26 * 3_600_000) } }, take: 500 });
    let sent = 0;
    for (const b of soon) {
      if (!dueForReminder({ status: b.status as BookingStatus, scheduledAt: b.scheduledAt, remindedAt: b.remindedAt }, now)) continue;
      const when = formatDateTime(b.scheduledAt!);
      await notify(tx, b.requesterId, { kind: "inspection.reminder", title: `Reminder: inspection ${b.ref} on ${when}`, body: `${b.meetingPoint ? `Meet at: ${b.meetingPoint}. ` : ""}Inspect before you pay anything. You can turn on a safety session from the booking page.`, link: `/me/inspections/${b.ref}` });
      if (b.assignedUserId) await notify(tx, b.assignedUserId, { kind: "inspection.reminder", title: `Reminder: inspection ${b.ref} on ${when}`, body: b.requesterName, link: `/app/bookings/${b.id}` });
      // Platform administrators may read bookings but not change them, so the mark is written as the company.
      await withTenant(b.companyId, "system", (c) => c.inspectionBooking.updateMany({ where: { id: b.id, companyId: b.companyId }, data: { remindedAt: now } }));
      sent++;
    }
    return { reminded: sent };
  });
}

export { isOpen };

/**
 * One person's confirmed inspections on one day, in time order, with where to meet, for the day's route on a map. A manager can
 * look at anyone's day; an agent sees their own.
 */
export async function dayRoute(ctx: Ctx, day: string, forUserId?: string) {
  assertCan(ctx, "booking.manage");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Choose a day");
  const who = ctx.role === "AGENT" || !forUserId ? ctx.userId : forUserId;
  const start = fromLagosLocal(`${day}T00:00`), end = new Date(start.getTime() + 864e5);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const rows = await tx.inspectionBooking.findMany({
      where: { companyId: ctx.companyId, assignedUserId: who, status: { in: ["CONFIRMED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "COMPLETED"] }, scheduledAt: { gte: start, lt: end } },
      orderBy: { scheduledAt: "asc" }, take: 30,
    });
    const listings = await tx.listing.findMany({ where: { id: { in: rows.map((r) => r.listingId) }, companyId: ctx.companyId }, select: { id: true, title: true, city: true } });
    const team = await tx.membership.findMany({ where: { companyId: ctx.companyId, status: "ACTIVE", role: { in: ["COMPANY_SUPER_ADMIN", "MANAGER", "AGENT"] } }, select: { userId: true, user: { select: { name: true } } } });
    return {
      day, userId: who, team: team.map((t) => ({ userId: t.userId, name: t.user.name })),
      stops: rows.map((r) => ({ id: r.id, ref: r.ref, at: r.scheduledAt!, minutes: r.durationMinutes, status: r.status, meetingPoint: r.meetingPoint, who: r.requesterName, lat: r.meetLat, lng: r.meetLng, title: listings.find((l) => l.id === r.listingId)?.title ?? r.ref, city: listings.find((l) => l.id === r.listingId)?.city ?? "" })),
    };
  });
}
