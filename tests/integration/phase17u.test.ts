/**
 * Phase 17u: reel drafts and personal suggestions. A draft is the author's alone until sent; what a signed-in person looks
 * at, saves and asks about shapes the properties suggested to them, and they can clear it or turn it off.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma, withTenant, withUser } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { reviewListing, saveListingDraft, setListingStatus } from "../../src/lib/services/listings";
import { registerSeeker, saveAgentProfile } from "../../src/lib/services/community";
import { discover, getReel, sendDraft, uploadReel } from "../../src/lib/services/reels";
import { clearSignals, mySignals, recordSignal, setPersonalise, suggestedListings } from "../../src/lib/services/signals";
import { newCompany, newPlatformAdmin } from "./helpers";
import type { Ctx } from "../../src/lib/services/context";

after(() => prisma.$disconnect());
const uid = () => randomUUID().slice(0, 6);
const MP4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d]);

test("a reel draft stays with its author until they send it for checking", async () => {
  const co = await newCompany("draft");
  await saveAgentProfile(co, { displayName: `Draft Agent ${uid()}`, headline: "", bio: "", listed: true, acceptsMessages: true });
  const d = await uploadReel(co.userId, { caption: "First take" }, { type: "video/mp4", bytes: MP4 }, { draft: true });
  assert.equal(d.status, "DRAFT");
  const seeker = await registerSeeker({ name: "Viewer One", email: `v${uid()}@example.test`, password: "a long enough password" });
  assert.equal(await withUser(seeker.userId, (tx) => tx.reel.findUnique({ where: { id: d.id } })), null, "nobody else can see a draft");
  assert.equal((await getReel(d.id, co.userId))?.status, "DRAFT");
  await assert.rejects(sendDraft(seeker.userId, d.id), /not found/);
  await sendDraft(co.userId, d.id, "Final caption");
  const sent = await getReel(d.id, co.userId);
  assert.equal(sent?.status, "PENDING");
  assert.equal(sent?.caption, "Final caption");
  await assert.rejects(sendDraft(co.userId, d.id), /not found/, "only a draft can be sent");
  assert.ok(!(await discover({ tab: "trending" })).rows.some((r) => r.id === d.id), "not public until checked");
});

async function listed(co: Ctx, admin: string, city: string, price: string, beds = "3") {
  const a = await createAsset(co, { name: `Home ${uid()}`, assetClass: "RESIDENTIAL", category: "Flat", companyRelationship: "OWNER", city, state: "Lagos" } as never);
  await saveListingDraft(co, a.id, { title: `${beds}-bedroom flat ${uid()}`, purpose: "RENT", pricePeriod: "YEAR", price, bedrooms: beds, city, state: "Lagos", propertyType: "FLAT" } as never);
  const l = await withTenant(co.companyId, co.userId, (tx) => tx.listing.findFirstOrThrow({ where: { assetId: a.id } }));
  await setListingStatus(co, a.id, "PENDING_REVIEW");
  await reviewListing(admin, l.id, "approve", "ok");
  return l;
}

test("suggestions follow what a person does, say why, and can be cleared or turned off", async () => {
  const admin = await newPlatformAdmin();
  const co = await newCompany("sugg");
  const city = `Suggestville ${uid()}`;
  const seen = await listed(co, admin.id, city, "4,000,000");
  const similar = await listed(co, admin.id, city, "4,200,000");
  const elsewhere = await listed(co, admin.id, `Faraway ${uid()}`, "4,000,000");
  const me = await registerSeeker({ name: "Ada Seeker", email: `s${uid()}@example.test`, password: "a long enough password" });

  assert.equal(await suggestedListings(me.userId), null, "nothing done yet, nothing suggested");
  await recordSignal(me.userId, { kind: "PROPERTY_VIEW", listingId: seen.id });
  await recordSignal(me.userId, { kind: "PROPERTY_VIEW", listingId: seen.id }); // a repeat within 30 minutes is not counted twice
  await recordSignal(me.userId, { kind: "ENQUIRY", publicRef: seen.publicRef });
  const s = (await mySignals(me.userId));
  assert.equal(s.count, 2);
  assert.deepEqual(s.summary.cities, [city.replace(/\b\w/g, (x) => x.toUpperCase())]);

  const picks = (await suggestedListings(me.userId))!;
  const ids = picks.map((p) => p.id);
  assert.ok(ids.includes(similar.id), "a similar home in the same place is suggested");
  assert.ok(!ids.includes(seen.id), "the one already asked about is not suggested again");
  assert.ok(!ids.includes(elsewhere.id));
  assert.match(picks.find((p) => p.id === similar.id)!.why[0], /where you have been looking/);

  await clearSignals(me.userId);
  assert.equal((await mySignals(me.userId)).count, 0);
  await setPersonalise(me.userId, false);
  await recordSignal(me.userId, { kind: "PROPERTY_VIEW", listingId: seen.id });
  assert.equal((await mySignals(me.userId)).count, 0, "nothing is recorded when suggestions are off");
  assert.equal(await suggestedListings(me.userId), null);

  const other = await registerSeeker({ name: "Other Person", email: `o${uid()}@example.test`, password: "a long enough password" });
  assert.equal(await withUser(other.userId, (tx) => tx.userSignal.count({ where: { userId: me.userId } })), 0, "one person cannot read another's history");
});
