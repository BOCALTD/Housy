/**
 * Phase 18f: finding the right home when there are many. Best match order with reasons, copies of one home grouped,
 * listings that stop showing unless confirmed every 45 days (with a reminder), and My search saved privately per person.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPlatformAdmin, withUser } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { confirmListings, getPublicListing, listingsToConfirm, remindUnconfirmedListings, reviewListing, saveListingDraft, searchListings, searchListingsPage, setListingStatus } from "../../src/lib/services/listings";
import { bestMatchPage, freshWhere } from "../../src/lib/services/best-match";
import { registerSeeker } from "../../src/lib/services/community";
import { clearSearchPref, getSearchPref, mySearchPicks, saveSearchPref } from "../../src/lib/services/search-prefs";
import { parseFilters } from "../../src/lib/listing-rules";
import type { Ctx } from "../../src/lib/services/context";
import { newCompany, newPlatformAdmin, PASSWORD } from "./helpers";

after(() => prisma.$disconnect());
const uid = () => Math.random().toString(36).slice(2, 8);
const CITY = `Matchville ${uid()}`;

async function publish(admin: { id: string }, co: Ctx, o: { price: string; beds?: string; title?: string }) {
  const asset = await createAsset(co, { name: `Listed ${uid()}`, assetClass: "RESIDENTIAL", category: "Flat", companyRelationship: "OWNER" });
  await saveListingDraft(co, asset.id, { title: o.title ?? `Flat ${uid()}`, purpose: "RENT", price: o.price, bedrooms: o.beds ?? "2", city: CITY, state: "Lagos" } as never);
  await setListingStatus(co, asset.id, "PENDING_REVIEW");
  const l = await withPlatformAdmin(admin.id, (tx) => tx.listing.findFirstOrThrow({ where: { assetId: asset.id } }));
  await reviewListing(admin.id, l.id, "approve", "ok");
  return withPlatformAdmin(admin.id, (tx) => tx.listing.findFirstOrThrow({ where: { id: l.id } }));
}

test("best match is the default order, keeps every listing, and pages cleanly", async () => {
  const admin = await newPlatformAdmin();
  const co = await newCompany("bestmatch");
  const made = [];
  for (let i = 0; i < 5; i++) made.push(await publish(admin, co, { price: `${2_000_000 + i * 100_000}` }));
  assert.ok(made.every((l) => l.confirmedAt), "approval counts as a confirmation");
  const f = parseFilters((k) => (k === "city" ? CITY : undefined));
  assert.equal(f.sort, "best");
  const page = await searchListingsPage(f, {});
  assert.equal(page.total, 5);
  assert.deepEqual(new Set(page.rows.map((r) => r.id)), new Set(made.map((m) => m.id)));
  assert.ok(page.rows.every((r) => "matchWhy" in r && Array.isArray(r.matchWhy)));
  const one = await bestMatchPage({ status: "PUBLISHED", city: CITY, AND: [freshWhere()] }, 2, 2);
  assert.equal(one.total, 5); assert.equal(one.pages, 3); assert.equal(one.rows.length, 2);
  const all = [...(await bestMatchPage({ status: "PUBLISHED", city: CITY }, 1, 2)).rows, ...one.rows, ...(await bestMatchPage({ status: "PUBLISHED", city: CITY }, 3, 2)).rows];
  assert.equal(new Set(all.map((r) => r.id)).size, 5, "no listing repeats or goes missing across pages");
});

test("an unconfirmed listing stops showing, its company is reminded once, and confirming brings it back", async () => {
  const admin = await newPlatformAdmin();
  const co = await newCompany("confirm");
  const l = await publish(admin, co, { price: "1,500,000", title: `Old flat ${uid()}` });
  const old = new Date(Date.now() - 50 * 864e5);
  await withPlatformAdmin(admin.id, (tx) => tx.listing.update({ where: { id: l.id }, data: { confirmedAt: old, publishedAt: old } }));
  assert.equal((await searchListings({ city: CITY })).some((x) => x.id === l.id), false, "hidden from search");
  assert.ok(await getPublicListing(l.publicRef), "its own page still opens, with a warning");
  const due = await listingsToConfirm(co);
  assert.deepEqual(due.map((d) => [d.id, d.expired]), [[l.id, true]]);

  await remindUnconfirmedListings();
  const told = await withUser(co.userId, (tx) => tx.notification.count({ where: { userId: co.userId, kind: "listing.confirm" } }));
  assert.equal(told, 1);
  await remindUnconfirmedListings();
  assert.equal(await withUser(co.userId, (tx) => tx.notification.count({ where: { userId: co.userId, kind: "listing.confirm" } })), 1, "only once");

  assert.equal(await confirmListings(co, [l.id]), 1);
  assert.equal((await searchListings({ city: CITY })).some((x) => x.id === l.id), true, "back in search");
  assert.equal((await listingsToConfirm(co)).length, 0);
  const other = await newCompany("confirm-other");
  assert.equal(await confirmListings(other, [l.id]), 0, "another company cannot confirm it");
});

test("my search is private, validated and fills the home page picks", async () => {
  const me = (await registerSeeker({ name: "Ada Search", email: `ada-${uid()}@example.test`, password: PASSWORD })).userId;
  const them = (await registerSeeker({ name: "Bo Other", email: `bo-${uid()}@example.test`, password: PASSWORD })).userId;
  await assert.rejects(saveSearchPref(me, {}), /at least one/);
  await assert.rejects(saveSearchPref(me, { maxPrice: "lots" }), /number of naira/);
  await saveSearchPref(me, { city: CITY, purpose: "RENT", maxPrice: "3,000,000", minBeds: "2" });
  assert.deepEqual(await getSearchPref(me), { city: CITY, purpose: "RENT", maxNaira: 3_000_000, minBeds: 2 });
  assert.equal(await withUser(them, (tx) => tx.searchPref.findUnique({ where: { userId: me } })), null, "nobody else can read it");
  const picks = await mySearchPicks(me, 10);
  assert.ok(picks && picks.rows.length >= 1);
  assert.ok(picks.rows.every((r) => r.why[0] === "Fits your search"));
  await clearSearchPref(me);
  assert.equal(await getSearchPref(me), null);
  assert.equal(await mySearchPicks(me), null);
});
