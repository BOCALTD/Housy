/**
 * Phase 17e: inspection bookings, inspection safety sessions and the Trust and Safety Centre.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPlatformAdmin, withPublic, withTenant, withUser } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { reviewListing, saveListingDraft, setListingStatus } from "../../src/lib/services/listings";
import { registerSeeker } from "../../src/lib/services/community";
import { advanceBooking, cancelByRequester, companyBooking, confirmBooking, inspectionReminders, myBooking, requestInspection } from "../../src/lib/services/inspection-bookings";
import { companySession, endSession, ownSession, raiseEmergency, recordPing, safetyHousekeeping, startSafetySession, trustedView } from "../../src/lib/services/safety";
import { adminCase, adminCases, caseAction, myCase, openCase, updateCase } from "../../src/lib/services/trust-cases";
import { addMember, newCompany, newPlatformAdmin } from "./helpers";

after(() => prisma.$disconnect());
const local = (d: Date) => new Date(d.getTime() + 3_600_000).toISOString().slice(0, 16);
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000);

async function setup(tag: string) {
  const a = await newCompany(`ib-${tag}`);
  const admin = await newPlatformAdmin();
  const asset = await createAsset(a, { name: `House ${tag}`, assetClass: "RESIDENTIAL", category: "House", companyRelationship: "OWNER" } as never);
  await saveListingDraft(a, asset.id, { title: `House to view ${tag}`, purpose: "RENT", price: "2,000,000", city: "Yaba", state: "Lagos" } as never);
  await setListingStatus(a, asset.id, "PENDING_REVIEW");
  const l = await withTenant(a.companyId, a.userId, (tx) => tx.listing.findFirstOrThrow({ where: { assetId: asset.id } }));
  await reviewListing(admin.id, l.id, "approve", "ok");
  const seeker = await registerSeeker({ name: `Seeker ${tag}`, email: `seek-${tag}-${Date.now()}@example.test`, password: "integration-test-pw" });
  return { a, admin, listing: { ...l, status: "PUBLISHED" }, seekerId: seeker.userId };
}

test("bookings: requested, confirmed without clashes, moved step by step, and private to the two sides", async () => {
  const { a, listing, seekerId } = await setup("b1");
  const other = await newCompany("ib-other");
  const agent = await addMember(a, "AGENT", "ibagent");
  const agent2 = await addMember(a, "AGENT", "ibagent2");

  await assert.rejects(requestInspection(seekerId, listing.publicRef, { name: "Ada", preferredAt: local(inHours(0.2)) }), /at least an hour/);
  const ref = await requestInspection(seekerId, listing.publicRef, { name: "Ada Obi", phone: "0803", preferredAt: local(inHours(30)), message: "Evening is best" });
  await assert.rejects(requestInspection(seekerId, listing.publicRef, { name: "Ada Obi", preferredAt: local(inHours(40)) }), /already have an inspection/);

  const b = await withTenant(a.companyId, a.userId, (tx) => tx.inspectionBooking.findFirstOrThrow({ where: { ref } }));
  assert.equal(b.status, "REQUESTED");
  assert.equal(await withTenant(other.companyId, other.userId, (tx) => tx.inspectionBooking.count({ where: { id: b.id } })), 0, "another company cannot see it");
  assert.equal(await withPublic((tx) => tx.inspectionBooking.count({ where: { id: b.id } })), 0);
  assert.equal((await companyBooking(other, b.id)), null);
  // The person who asked cannot confirm their own booking by going round the service.
  await assert.rejects(withUser(seekerId, (tx) => tx.inspectionBooking.update({ where: { id: b.id }, data: { status: "CONFIRMED", scheduledAt: inHours(30) } })));

  await confirmBooking(a, b.id, { scheduledAt: local(inHours(30)), durationMinutes: "60", assignedUserId: agent.userId, meetingPoint: "Gate" });
  // A second booking for the same agent at an overlapping time is refused.
  const asset2 = await createAsset(a, { name: "Second house", assetClass: "RESIDENTIAL", category: "House", companyRelationship: "OWNER" } as never);
  await saveListingDraft(a, asset2.id, { title: "Second house to view", purpose: "SALE", price: "50,000,000", city: "Yaba", state: "Lagos" } as never);
  await setListingStatus(a, asset2.id, "PENDING_REVIEW");
  const l2 = await withTenant(a.companyId, a.userId, (tx) => tx.listing.findFirstOrThrow({ where: { assetId: asset2.id } }));
  await reviewListing((await newPlatformAdmin()).id, l2.id, "approve", "ok");
  const refB = await requestInspection(seekerId, l2.publicRef, { name: "Ada Obi", preferredAt: local(inHours(30.5)) });
  const bB = await withTenant(a.companyId, a.userId, (tx) => tx.inspectionBooking.findFirstOrThrow({ where: { ref: refB } }));
  await assert.rejects(confirmBooking(a, bB.id, { scheduledAt: local(inHours(30.5)), durationMinutes: "60", assignedUserId: agent.userId }), /clashes/);
  await confirmBooking(a, bB.id, { scheduledAt: local(inHours(30.5)), durationMinutes: "60", assignedUserId: agent2.userId });

  // Reminders go once, about a day before.
  await withTenant(a.companyId, a.userId, (tx) => tx.inspectionBooking.update({ where: { id: b.id }, data: { scheduledAt: inHours(20) } }));
  const r1 = await inspectionReminders();
  assert.ok(r1.reminded >= 1);
  assert.notEqual((await withTenant(a.companyId, a.userId, (tx) => tx.inspectionBooking.findFirstOrThrow({ where: { id: b.id } }))).remindedAt, null);
  await inspectionReminders();
  const bookingNotes = await withUser(seekerId, (tx) => tx.notification.count({ where: { userId: seekerId, kind: "inspection.reminder", link: `/me/inspections/${ref}` } }));
  assert.equal(bookingNotes, 1, "reminded once only");

  // Steps in order; an agent who is not assigned cannot move it; the requester cannot cancel once the agent is there.
  await assert.rejects(advanceBooking(a, b.id, "IN_PROGRESS", ""), /cannot become/);
  await assert.rejects(advanceBooking(agent2, b.id, "EN_ROUTE", ""), /Only the person meeting them/);
  await advanceBooking(agent, b.id, "EN_ROUTE", "");
  await advanceBooking(agent, b.id, "ARRIVED", "");
  await assert.rejects(cancelByRequester(seekerId, ref, "changed my mind"), /can no longer be cancelled/);
  await advanceBooking(agent, b.id, "IN_PROGRESS", "");
  await advanceBooking(agent, b.id, "COMPLETED", "Liked it; may offer");
  const seen = await myBooking(seekerId, ref);
  assert.equal(seen!.status, "COMPLETED");
  assert.deepEqual(seen!.events.map((e) => e.toStatus), ["REQUESTED", "CONFIRMED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "COMPLETED"]);
  // Rescheduling a confirmed one records both steps.
  await confirmBooking(a, bB.id, { scheduledAt: local(inHours(50)), durationMinutes: "45", assignedUserId: agent2.userId });
  const bb = await companyBooking(a, bB.id);
  assert.deepEqual(bb!.events.map((e) => e.toStatus), ["REQUESTED", "CONFIRMED", "RESCHEDULED", "CONFIRMED"]);
  assert.equal(bb!.rescheduleCount, 1);
  await cancelByRequester(seekerId, refB, "Found another place");
});

test("safety sessions: consent, privacy, automatic stop, trusted link and emergency", async () => {
  const { a, admin, listing, seekerId } = await setup("s1");
  const agent = await addMember(a, "AGENT", "sagent");
  const stranger = await registerSeeker({ name: "Stranger", email: `str-${Date.now()}@example.test`, password: "integration-test-pw" });
  const ref = await requestInspection(seekerId, listing.publicRef, { name: "Ada", preferredAt: local(inHours(5)) });
  const b = await withTenant(a.companyId, a.userId, (tx) => tx.inspectionBooking.findFirstOrThrow({ where: { ref } }));
  await assert.rejects(startSafetySession(seekerId, ref, { expectedMinutes: 60, consent: true }), /once the inspection is confirmed/);
  await confirmBooking(a, b.id, { scheduledAt: local(inHours(5)), durationMinutes: "60", assignedUserId: agent.userId });
  await assert.rejects(startSafetySession(seekerId, ref, { expectedMinutes: 60, consent: false as never }), /agree/);
  await assert.rejects(startSafetySession(stranger.userId, ref, { expectedMinutes: 60, consent: true }), /not found/);

  // The agent attends for the company: the company can see the session.
  const ag = await startSafetySession(agent.userId, ref, { expectedMinutes: 60, consent: true, trustedName: "Mum", trustedPhone: "0803" });
  assert.ok(ag.shareToken);
  await assert.rejects(startSafetySession(agent.userId, ref, { expectedMinutes: 60, consent: true }), /already have a safety session/);
  await recordPing(agent.userId, ag.id, { lat: 6.5, lng: 3.38, accuracy: 15 });
  assert.equal((await recordPing(agent.userId, ag.id, { lat: 6.5, lng: 3.38 })).stored, false, "at most one point every 20 seconds");
  const seenByCompany = await companySession(a, ag.id);
  assert.equal(seenByCompany!.pings.length, 1);
  assert.equal(seenByCompany!.lastLat, 6.5);
  const tv = await trustedView(ag.shareToken!);
  assert.equal(tv!.live, true);
  assert.equal(tv!.last!.lat, 6.5);
  assert.equal(await trustedView("x".repeat(30)), null);

  // The seeker's own session is private to them: the company cannot see it.
  const own = await startSafetySession(seekerId, ref, { expectedMinutes: 30, consent: true });
  assert.equal(await companySession(a, own.id), null);
  assert.equal(await withUser(stranger.userId, (tx) => tx.safetySession.count({ where: { id: own.id } })), 0);

  // Emergency: a critical case is opened and the company's managers are told.
  const caseRef = await raiseEmergency(agent.userId, ag.id, "Two men at the gate");
  const c = await adminCase(admin.id, caseRef);
  assert.equal(c!.severity, "CRITICAL");
  const notes = await withUser(a.userId, (tx) => tx.notification.findMany({ where: { userId: a.userId, kind: "security.safety_emergency" } }));
  assert.ok(notes.length >= 1);

  // Ending stops location; no point is accepted after.
  await endSession(agent.userId, ag.id, "CHECKED_OUT");
  await assert.rejects(recordPing(agent.userId, ag.id, { lat: 6.5, lng: 3.38 }), /ended/);
  assert.equal((await trustedView(ag.shareToken!))!.last, null, "no location after the session ends");
  // A session left running past its expected end stops by itself.
  await withUser(seekerId, (tx) => tx.safetySession.update({ where: { id: own.id }, data: { expectedEndAt: inHours(-3), startedAt: inHours(-4) } }));
  await safetyHousekeeping();
  assert.equal((await ownSession(seekerId, own.id))!.endReason, "AUTO_STOPPED");
});

test("Trust and Safety: reports are private, reviewers handle them, and the reporter is told the outcome", async () => {
  const { admin, listing, seekerId } = await setup("t1");
  const stranger = await registerSeeker({ name: "Other", email: `oth-${Date.now()}@example.test`, password: "integration-test-pw" });
  await assert.rejects(openCase(seekerId, { category: "NOPE", description: "something happened here" }, []), /Choose what/);
  await assert.rejects(openCase(seekerId, { category: "FRAUD", description: "short" }, []), /few sentences/);
  const png = { type: "image/png", name: "shot.png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]) };
  const ref = await openCase(seekerId, { category: "SUSPICIOUS_LISTING", targetKind: "LISTING", targetRef: listing.publicRef, description: "They asked for a reservation fee before any inspection." }, [png]);
  assert.equal((await myCase(stranger.userId, ref)), null);
  assert.equal(await withUser(stranger.userId, (tx) => tx.trustCase.count({ where: { ref } })), 0);
  const mine = await myCase(seekerId, ref);
  assert.equal(mine!.evidence.length, 1);
  assert.ok((await adminCases(admin.id, {})).some((c) => c.ref === ref));

  await updateCase(admin.id, ref, { assignToId: admin.id, status: "INVESTIGATING", note: "Private: called the company", messageToReporter: "" });
  assert.ok(!(await myCase(seekerId, ref))!.events.some((e) => e.body.includes("Private")), "private notes are not shown to the reporter");
  await assert.rejects(updateCase(admin.id, ref, { status: "ACTION_TAKEN", messageToReporter: "" }), /tell the reporter/);
  await caseAction(admin.id, ref, "TAKE_LISTING_OFFLINE", "Reservation fee scam reported; checking with the company");
  assert.equal((await withPlatformAdmin(admin.id, (tx) => tx.listing.findFirstOrThrow({ where: { publicRef: listing.publicRef } }))).status, "UNAVAILABLE");
  await updateCase(admin.id, ref, { status: "ACTION_TAKEN", messageToReporter: "We took the listing offline while we check with the company. Thank you." });
  const done = await myCase(seekerId, ref);
  assert.equal(done!.status, "ACTION_TAKEN");
  assert.match(done!.outcomeForReporter, /took the listing offline/);
  // A reviewer cannot handle their own report.
  const own = await openCase(admin.id, { category: "OTHER", description: "Reported by the reviewer themselves" }, []);
  await assert.rejects(updateCase(admin.id, own, { note: "x" }), /reported yourself/);
});
