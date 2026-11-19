/**
 * Designed promo banners and the promo layout switch; likes, dislikes and shares; and Undo for everyday actions.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { prisma, withPlatformAdmin, withUser } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { reviewListing, saveListingDraft, setListingStatus } from "../../src/lib/services/listings";
import { addListingPhoto } from "../../src/lib/services/listing-photos";
import { adminBanners, bannerImage, bannersFor, promoLayoutOn, removeBanner, saveBanner, setBannerActive, setPromoLayout } from "../../src/lib/services/banners";
import { mySharedListings, reactionSummary, setReaction, setShared } from "../../src/lib/services/reactions";
import { runUndo } from "../../src/lib/services/undo";
import "../../src/lib/services/undo-handlers";
import { followWithUndo, removeListingPhotoWithUndo, deleteSearchWithUndo, markReadWithUndo, unshareListingWithUndo } from "../../src/lib/services/undo-everyday";
import { saveSearch } from "../../src/lib/services/alerts";
import { registerSeeker, saveAgentProfile } from "../../src/lib/services/community";
import { notify } from "../../src/lib/services/notifications";
import type { Ctx } from "../../src/lib/services/context";
import { newCompany, newPlatformAdmin, PASSWORD } from "./helpers";

after(() => prisma.$disconnect());

const uid = () => Math.random().toString(36).slice(2, 8);
const picture = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 40, b: 60 } } }).png().toBuffer().then((b) => new Uint8Array(b));
const seeker = async () => (await registerSeeker({ name: `React Person ${uid()}`, email: `react-${uid()}@example.test`, password: PASSWORD })).userId;

async function published(admin: { id: string }, co: Ctx) {
  const asset = await createAsset(co, { name: `Flat ${uid()}`, assetClass: "RESIDENTIAL", category: "Flat", companyRelationship: "OWNER" });
  await saveListingDraft(co, asset.id, { title: `Flat ${uid()}`, purpose: "RENT", price: "2,000,000", bedrooms: "2", city: "Lagos", state: "Lagos" } as never);
  await setListingStatus(co, asset.id, "PENDING_REVIEW");
  const l = await withPlatformAdmin(admin.id, (tx) => tx.listing.findFirstOrThrow({ where: { assetId: asset.id } }));
  await reviewListing(admin.id, l.id, "approve", "ok");
  return { asset, listing: l };
}

test("banners: designed pictures, places, dates and the promo layout switch, with undo", async () => {
  const admin = await newPlatformAdmin();
  const co = await newCompany("bannerco");
  await assert.rejects(saveBanner(co.userId, null, { title: "Not allowed", places: ["HOME"] }, { desktop: await picture(1600, 500) }), /platform administrator/);
  await assert.rejects(saveBanner(admin.id, null, { title: "Too small", places: ["HOME"] }, { desktop: await picture(300, 100) }), /too small/);
  await assert.rejects(saveBanner(admin.id, null, { title: "Not a picture", places: ["HOME"] }, { desktop: new TextEncoder().encode("<svg/>") }), /not a picture/);
  await assert.rejects(saveBanner(admin.id, null, { title: "Bad link", places: ["HOME"], linkUrl: "javascript:alert(1)" }, { desktop: await picture(1600, 500) }), /page on this site/);
  await assert.rejects(saveBanner(admin.id, null, { title: "Nowhere", places: [] }, { desktop: await picture(1600, 500) }), /Choose where/);

  const tag = uid();
  const id = await saveBanner(admin.id, null, { title: `Festive sale ${tag}`, places: ["HOME", "SEARCH"], linkUrl: "/browse?city=Lekki", fold: "TOP_RIGHT", float: true }, { desktop: await picture(3200, 1000), mobile: await picture(1080, 1080) });
  const row = (await adminBanners(admin.id)).find((b) => b.id === id)!;
  assert.equal(row.desktopW, 2400, "wide pictures are scaled down for quick pages");
  assert.equal(row.mobileW, 1080);
  assert.equal((await bannerImage(id, "desktop", null))?.mime, "image/webp");
  const later = await saveBanner(admin.id, null, { title: `Later ${tag}`, places: ["HOME"], startsAt: "2099-01-01" }, { desktop: await picture(1600, 500) });

  await setPromoLayout(admin.id, true);
  const home = await bannersFor("HOME");
  assert.ok(home.some((b) => b.id === id));
  assert.ok(!home.some((b) => b.id === later), "a banner shows only from its start date");
  assert.ok((await bannersFor("SEARCH")).some((b) => b.id === id));
  assert.ok(!(await bannersFor("DASHBOARD")).some((b) => b.id === id));

  // Hiding, removing and the switch each come with Undo.
  const hid = await setBannerActive(admin.id, id, false);
  assert.ok(!(await bannersFor("HOME")).some((b) => b.id === id));
  assert.equal(await bannerImage(id, "desktop", null), null, "a hidden banner's picture is not public");
  assert.ok(await bannerImage(id, "desktop", admin.id), "the administrator can still preview it");
  await runUndo({ userId: admin.id, member: null }, hid);
  assert.ok((await bannersFor("HOME")).some((b) => b.id === id));
  const off = await setPromoLayout(admin.id, false);
  assert.equal(await promoLayoutOn(), false);
  assert.equal((await bannersFor("HOME")).length, 0, "with the promo layout off no banner shows");
  await runUndo({ userId: admin.id, member: null }, off!);
  assert.equal(await promoLayoutOn(), true);
  const gone = await removeBanner(admin.id, later);
  assert.ok(!(await adminBanners(admin.id)).some((b) => b.id === later));
  await runUndo({ userId: admin.id, member: null }, gone);
  assert.ok((await adminBanners(admin.id)).some((b) => b.id === later));
  // The public cannot change banners, even straight in the database.
  await assert.rejects(withUser(co.userId, (tx) => tx.promoBanner.update({ where: { id }, data: { active: false } })));
  await removeBanner(admin.id, id); await removeBanner(admin.id, later);
});

test("likes, dislikes and shares: one each per person, counted, on visible items only, and reversible", async () => {
  const admin = await newPlatformAdmin();
  const co = await newCompany("reactco");
  const { listing } = await published(admin, co);
  const a = await seeker(), b = await seeker();
  let s = await setReaction(a, "LISTING", listing.id, "LIKE");
  assert.deepEqual([s.likes, s.dislikes, s.mine], [1, 0, "LIKE"]);
  await setReaction(b, "LISTING", listing.id, "DISLIKE");
  s = await setReaction(a, "LISTING", listing.id, "DISLIKE");
  assert.deepEqual([s.likes, s.dislikes, s.mine], [0, 2, "DISLIKE"], "changing your mind moves your one reaction");
  s = await setReaction(a, "LISTING", listing.id, null);
  assert.deepEqual([s.likes, s.dislikes, s.mine], [0, 1, null]);
  s = await setShared(a, "LISTING", listing.id, true);
  assert.deepEqual([s.shares, s.shared], [1, true]);
  assert.equal((await mySharedListings(a)).length, 1);
  const undo = await unshareListingWithUndo(a, listing.id);
  assert.equal((await reactionSummary("LISTING", listing.id, a)).shares, 0);
  await runUndo({ userId: a, member: null }, undo);
  assert.equal((await reactionSummary("LISTING", listing.id, a)).shared, true, "undo puts the share back");
  // Someone else's reaction cannot be changed in the database.
  await assert.rejects(withUser(b, (tx) => tx.contentReaction.updateMany({ where: { userId: a }, data: { value: "LIKE" } })).then((r) => { if (r.count === 0) throw new Error("not changed"); }));
  // Not on items the public cannot see.
  await setListingStatus(co, listing.assetId, "DRAFT").catch(() => undefined);
  await withPlatformAdmin(admin.id, (tx) => tx.listing.update({ where: { id: listing.id }, data: { status: "DRAFT" } }));
  await assert.rejects(setReaction(a, "LISTING", listing.id, "LIKE"), /no longer available/);
});

test("undo: only the person who did it, only once, only in time, and workspace actions only in that workspace", async () => {
  const admin = await newPlatformAdmin();
  const co = await newCompany("undoco");
  const other = await newCompany("undoother");
  const me = await seeker();
  await saveAgentProfile(co, { displayName: "Undo Agent", headline: "", bio: "", listed: true, acceptsMessages: true });

  const f = await followWithUndo(me, "AGENT", co.userId, true);
  await assert.rejects(runUndo({ userId: other.userId, member: null }, f), /nothing to undo/);
  await runUndo({ userId: me, member: null }, f);
  assert.equal(await withUser(me, (tx) => tx.follow.count({ where: { followerId: me, targetId: co.userId } })), 0);
  await assert.rejects(runUndo({ userId: me, member: null }, f), /already undone/);

  const searchId = (await saveSearch(me, { name: "Lekki flats", city: "Lekki" } as never)).id;
  const del = await deleteSearchWithUndo(me, searchId);
  await assert.rejects(runUndo({ userId: me, member: null }, del!, new Date(Date.now() + 5 * 60_000)), /too late/);
  // A late try does not use it up, but it is still too late after the window; within the window it works.
  const s2 = (await saveSearch(me, { name: "Ikoyi", city: "Ikoyi" } as never)).id;
  const del2 = await deleteSearchWithUndo(me, s2);
  await runUndo({ userId: me, member: null }, del2!);
  assert.equal(await withUser(me, (tx) => tx.savedSearch.count({ where: { id: s2 } })), 1);

  await withPlatformAdmin(admin.id, (tx) => notify(tx, me, { kind: "test", title: "One", body: "" }));
  await withPlatformAdmin(admin.id, (tx) => notify(tx, me, { kind: "test", title: "Two", body: "" }));
  const read = await markReadWithUndo(me, null);
  await runUndo({ userId: me, member: null }, read!);
  assert.equal(await withUser(me, (tx) => tx.notification.count({ where: { userId: me, readAt: null } })), 2);

  // A removed photograph comes back in the same place, but only in its own workspace.
  const { asset } = await published(admin, co);
  const p1 = await addListingPhoto(co, asset.id, { type: "image/png", bytes: await picture(800, 600) }, "Front");
  const p2 = await addListingPhoto(co, asset.id, { type: "image/png", bytes: await picture(800, 600) }, "Kitchen");
  const rm = await removeListingPhotoWithUndo(co, asset.id, p1);
  await assert.rejects(runUndo({ userId: co.userId, member: other }, rm!), /Switch back/);
  await runUndo({ userId: co.userId, member: co }, rm!);
  const photos = await prisma.$transaction(async (tx) => { await tx.$queryRaw`SELECT set_config('app.company_id', ${co.companyId}, true)`; return tx.listingPhoto.findMany({ where: { companyId: co.companyId }, orderBy: { position: "asc" }, select: { id: true } }); });
  assert.deepEqual(photos.map((p) => p.id), [p1, p2]);
});
