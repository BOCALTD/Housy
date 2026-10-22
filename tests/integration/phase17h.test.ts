/**
 * Phase 17h: inspection calendar files and private calendar feeds.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withTenant, withUser } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { reviewListing, saveListingDraft, setListingStatus } from "../../src/lib/services/listings";
import { registerSeeker } from "../../src/lib/services/community";
import { confirmBooking, requestInspection } from "../../src/lib/services/inspection-bookings";
import { bookingIcsForCompany, bookingIcsForRequester, feedByToken, feedStatus, makeFeed, removeFeed } from "../../src/lib/services/calendar";
import { suspendCompany } from "../../src/lib/services/governance";
import { addMember, newCompany, newPlatformAdmin, withRole } from "./helpers";

after(() => prisma.$disconnect());
const local = (d: Date) => new Date(d.getTime() + 3_600_000).toISOString().slice(0, 16);
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000);
const ORIGIN = "https://housy.example";

test("calendar: a confirmed inspection downloads for both sides, and a private feed shows each person only their own", async () => {
  const a = await newCompany("cal-a");
  const admin = await newPlatformAdmin();
  const asset = await createAsset(a, { name: "Calendar house", assetClass: "RESIDENTIAL", category: "House", companyRelationship: "OWNER" } as never);
  await saveListingDraft(a, asset.id, { title: "Calendar house to view", purpose: "RENT", price: "2,000,000", city: "Yaba", state: "Lagos" } as never);
  await setListingStatus(a, asset.id, "PENDING_REVIEW");
  const l = await withTenant(a.companyId, a.userId, (tx) => tx.listing.findFirstOrThrow({ where: { assetId: asset.id } }));
  await reviewListing(admin.id, l.id, "approve", "ok");
  const seeker = await registerSeeker({ name: "Cal Seeker", email: `cal-seek-${Date.now()}@example.test`, password: "integration-test-pw" });
  const stranger = await registerSeeker({ name: "Cal Stranger", email: `cal-str-${Date.now()}@example.test`, password: "integration-test-pw" });
  const agent = await addMember(a, "AGENT", "calagent");
  const other = await addMember(a, "AGENT", "calother");

  const ref = await requestInspection(seeker.userId, l.publicRef, { name: "Cal Seeker", phone: "08031234567", preferredAt: local(inHours(30)) });
  const b = await withTenant(a.companyId, a.userId, (tx) => tx.inspectionBooking.findFirstOrThrow({ where: { ref } }));
  assert.equal(await bookingIcsForRequester(seeker.userId, ref, ORIGIN), null, "nothing to add before a time is confirmed");
  await confirmBooking(a, b.id, { scheduledAt: local(inHours(30)), durationMinutes: "60", assignedUserId: agent.userId, meetingPoint: "Main gate" });

  const mine = await bookingIcsForRequester(seeker.userId, ref, ORIGIN);
  assert.ok(mine);
  assert.match(mine.ics, /SUMMARY:Property inspection: Calendar house to view/);
  assert.match(mine.ics, /LOCATION:Main gate/);
  assert.equal(await bookingIcsForRequester(stranger.userId, ref, ORIGIN), null);
  const staff = await bookingIcsForCompany(a, b.id, ORIGIN);
  assert.match(staff!.ics, /Visitor: Cal Seeker/);
  assert.doesNotMatch(staff!.ics.replace(/\r\n /g, ""), /08031234567/, "the visitor's phone stays out of calendars");
  await assert.rejects(bookingIcsForCompany(withRole(a, "OFFICER"), b.id, ORIGIN), /permission/);
  assert.equal(await bookingIcsForCompany(await newCompany("cal-b"), b.id, ORIGIN), null);

  // Feeds
  assert.equal(await feedStatus(seeker.userId), null);
  const seekerToken = await makeFeed(seeker.userId);
  const agentToken = await makeFeed(agent.userId);
  const otherToken = await makeFeed(other.userId);
  assert.ok(await feedStatus(seeker.userId));
  assert.match((await feedByToken(seekerToken, ORIGIN))!, new RegExp(`UID:${b.id}@housy-inspections`));
  assert.match((await feedByToken(agentToken, ORIGIN))!, /Inspection .*: Calendar house to view/);
  assert.doesNotMatch((await feedByToken(otherToken, ORIGIN))!, /VEVENT/, "a colleague not meeting them sees nothing");
  assert.equal(await feedByToken("not-a-real-token-at-all-xxxx", ORIGIN), null);
  // The feed table cannot be read without the secret or as someone else.
  assert.equal(await withUser(stranger.userId, (tx) => tx.calendarFeed.count()), 0);

  const replaced = await makeFeed(seeker.userId);
  assert.equal(await feedByToken(seekerToken, ORIGIN), null, "a new link stops the old one");
  assert.ok(await feedByToken(replaced, ORIGIN));
  await removeFeed(seeker.userId);
  assert.equal(await feedByToken(replaced, ORIGIN), null);

  // A suspended company's inspections leave its staff's feeds.
  await suspendCompany(admin.id, a.companyId, { reason: "Checking reports of fraud" });
  assert.doesNotMatch((await feedByToken(agentToken, ORIGIN))!, /VEVENT/);
});
