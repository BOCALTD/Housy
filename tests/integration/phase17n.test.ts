/**
 * Phase 17n: location intelligence. Radius search, nearby places from public map data (cached, never sent a person's data),
 * travel times, site outlines that appear publicly only when the company chooses, and the exact meeting spot given to a visitor
 * only once their inspection is confirmed.
 */
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma, withPublic, withTenant, withUser } from "../../src/lib/db";
import { createAsset, setAssetBoundary, setAssetPosition } from "../../src/lib/services/assets";
import { getPublicListing, reviewListing, saveListingDraft, setListingStatus } from "../../src/lib/services/listings";
import { mapNear } from "../../src/lib/services/street-map";
import { nearbyForListing, setNearbyFetchForTests, travelToListing } from "../../src/lib/services/nearby";
import { confirmBooking, dayRoute, myBooking, requestInspection } from "../../src/lib/services/inspection-bookings";
import { registerSeeker } from "../../src/lib/services/community";
import { nearbyCell } from "../../src/lib/location-rules";
import { newCompany, newPlatformAdmin } from "./helpers";

after(() => prisma.$disconnect());
afterEach(() => setNearbyFetchForTests(null));
const local = (d: Date) => new Date(d.getTime() + 3_600_000).toISOString().slice(0, 16);

let spot = 0;
async function setup(label: string) {
  const co = await newCompany(label);
  const admin = await newPlatformAdmin();
  // A remote spot so other tests' listings are not nearby: the Sahara, a degree apart for each test, a little apart per run.
  spot += 1;
  const base = { lat: Math.round((14 + spot * 1.5 + Math.random() * 0.3) * 1e4) / 1e4, lng: Math.round((8 + spot * 1.5) * 1e4) / 1e4 };
  async function listed(name: string, dLat: number, dLng: number) {
    const a = await createAsset(co, { name, assetClass: "LAND", category: "Estate", companyRelationship: "OWNER", city: "Testville", state: "Desert" } as never);
    await setAssetPosition(co, a.id, { lat: String(base.lat + dLat), lng: String(base.lng + dLng) });
    await saveListingDraft(co, a.id, { title: `${name} ${randomUUID().slice(0, 6)}`, purpose: "SALE", price: "50,000,000", city: "Testville", state: "Desert", propertyType: "LAND" } as never);
    const l = await withTenant(co.companyId, co.userId, (tx) => tx.listing.findFirstOrThrow({ where: { assetId: a.id } }));
    await setListingStatus(co, a.id, "PENDING_REVIEW"); await reviewListing(admin.id, l.id, "approve", "ok");
    return { asset: a, listing: (await withTenant(co.companyId, co.userId, (tx) => tx.listing.findFirstOrThrow({ where: { id: l.id } }))) };
  }
  return { co, admin, base, listed };
}

test("radius search finds what is within the distance, nearest first, and nothing beyond it", async () => {
  const { base, listed } = await setup("radius");
  await listed("Close plot", 0.005, 0);
  await listed("Mid plot", 0.03, 0);
  await listed("Far plot", 0.2, 0);
  const r = await mapNear(base, 5, 12, {});
  assert.equal(r.total, 2);
  assert.match(r.list[0].title, /^Close plot/); assert.match(r.list[1].title, /^Mid plot/);
  assert.match(r.list[0].distance!, /m$/); assert.match(r.list[1].distance!, /km$/);
  assert.ok((await mapNear(base, 50, 9, {})).list.some((x) => /^Far plot/.test(x.title)));
});

test("nearby places come from one cached lookup per area; a failure is reported, and only the blurred position is sent", async () => {
  const { listed } = await setup("nearby");
  const { listing } = await listed("Nearby plot", 0, 0);
  const sent: string[] = [];
  let answer: "ok" | "fail" = "ok";
  setNearbyFetchForTests((async (_url: string, init?: RequestInit) => {
    sent.push(String(init?.body ?? ""));
    if (answer === "fail") throw new Error("network down");
    return new Response(JSON.stringify({ elements: [
      { type: "node", lat: listing.lat! + 0.002, lon: listing.lng!, tags: { amenity: "school", name: "Test Academy" } },
      { type: "node", lat: listing.lat!, lon: listing.lng! + 0.003, tags: { amenity: "pharmacy" } },
    ] }), { status: 200 });
  }) as typeof fetch);
  await prisma.nearbyCache.deleteMany({ where: { cell: nearbyCell({ lat: listing.lat!, lng: listing.lng! }) } });
  const a = await nearbyForListing(listing.publicRef, {});
  assert.ok(a.available);
  assert.deepEqual(a.summary.map((s) => s.kind), ["school", "pharmacy"]);
  assert.equal(a.summary[0].nearest[0].name, "Test Academy");
  // The second look is served from the cache.
  await nearbyForListing(listing.publicRef, {});
  assert.equal(sent.length, 1);
  // Only the cell centre (the blurred public position) goes out; the asset's exact position never does.
  const asset = await withTenant(listing.companyId, "system", (tx) => tx.asset.findFirstOrThrow({ where: { id: listing.assetId } }));
  assert.ok(!decodeURIComponent(sent[0]).includes(asset.lat!.toFixed(5)));
  // A failed lookup on an empty cache says so instead of showing nothing as if there were nothing.
  await prisma.nearbyCache.deleteMany({ where: { cell: nearbyCell({ lat: listing.lat!, lng: listing.lng! }) } });
  answer = "fail";
  assert.deepEqual(await nearbyForListing(listing.publicRef, {}), { available: false, reason: "unavailable" });
  assert.deepEqual(await nearbyForListing(listing.publicRef, { NEARBY_PLACES: "off" }), { available: false, reason: "off" });
});

test("travel time is an estimate without a routing server, and a real route with one", async () => {
  const { listed } = await setup("travel");
  const { listing } = await listed("Travel plot", 0, 0);
  const from = { lat: listing.lat! + 0.1, lng: listing.lng! };
  const e = await travelToListing(listing.publicRef, from, {});
  assert.equal(e?.kind, "estimate");
  setNearbyFetchForTests((async (url: string) => {
    assert.match(String(url), /^https:\/\/router\.test\/route\/v1\/driving\//);
    return new Response(JSON.stringify({ code: "Ok", routes: [{ distance: 14800, duration: 1260 }] }), { status: 200 });
  }) as typeof fetch);
  const r = await travelToListing(listing.publicRef, from, { ROUTING_URL: "https://router.test/" });
  assert.deepEqual(r && r.kind === "route" ? [r.km, r.minutes] : null, [14.8, 21]);
  assert.equal(await travelToListing("PROP-NOPE0000", from, {}), null);
});

test("a site outline is the company's; it appears on the listing only when they choose to show it", async () => {
  const { co, listed, base } = await setup("outline");
  const { asset, listing } = await listed("Estate land", 0, 0);
  const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
  const ring: [number, number][] = ([[-1, -1], [-1, 1], [1, 1], [1, -1]] as const).map(([a, b]) => [r6(base.lat + a * 0.002), r6(base.lng + b * 0.002)] as [number, number]);
  await assert.rejects(setAssetBoundary(co, asset.id, ring.slice(0, 2), true), /at least 3 corners/);
  await assert.rejects(setAssetBoundary(co, asset.id, [ring[0], ring[2], ring[1], ring[3]], true), /crosses itself/);
  await setAssetBoundary(co, asset.id, ring, false);
  assert.equal((await getPublicListing(listing.publicRef))!.boundary, null, "private outline: not on the listing");
  await setAssetBoundary(co, asset.id, ring, true);
  assert.deepEqual((await getPublicListing(listing.publicRef))!.boundary, ring);
  // Clearing removes it everywhere; the database refuses a public flag without an outline.
  await setAssetBoundary(co, asset.id, null, true);
  assert.equal((await getPublicListing(listing.publicRef))!.boundary, null);
  await assert.rejects(withTenant(co.companyId, co.userId, (tx) => tx.asset.update({ where: { id: asset.id }, data: { boundaryPublic: true } })));
  assert.equal(await withPublic((tx) => tx.asset.count({ where: { id: asset.id } })), 0, "the public never reads the asset itself");
});

test("the exact meeting spot is given to the visitor only once the inspection is confirmed, and builds the agent's day route", async () => {
  const { co, listed, base } = await setup("meet");
  const { listing } = await listed("Meeting plot", 0.001, 0.001);
  const seeker = await registerSeeker({ name: "Visitor", email: `visit-${randomUUID().slice(0, 8)}@example.test`, password: "integration-test-pw" });
  const at = new Date(Date.now() + 30 * 3_600_000);
  const ref = await requestInspection(seeker.userId, listing.publicRef, { name: "Visitor", preferredAt: local(at) });
  let mine = await myBooking(seeker.userId, ref);
  assert.equal(mine!.meetLat, null, "no exact spot before confirmation");
  const b = await withTenant(co.companyId, co.userId, (tx) => tx.inspectionBooking.findFirstOrThrow({ where: { ref } }));
  await confirmBooking(co, b.id, { scheduledAt: local(at), durationMinutes: "60", assignedUserId: co.userId, meetingPoint: "Site gate" });
  mine = await myBooking(seeker.userId, ref);
  assert.ok(Math.abs(mine!.meetLat! - (base.lat + 0.001)) < 1e-9 && Math.abs(mine!.meetLng! - (base.lng + 0.001)) < 1e-9, "the exact position, not the blurred one");
  const day = local(at).slice(0, 10);
  const route = await dayRoute(co, day);
  assert.ok(route.stops.some((s) => s.ref === ref && s.lat !== null));
  // Another person's booking stays theirs.
  const stranger = await registerSeeker({ name: "Stranger", email: `str-${randomUUID().slice(0, 8)}@example.test`, password: "integration-test-pw" });
  assert.equal(await myBooking(stranger.userId, ref), null);
  assert.equal(await withUser(stranger.userId, (tx) => tx.inspectionBooking.count({ where: { ref } })), 0);
});
