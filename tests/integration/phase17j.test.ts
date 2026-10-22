/**
 * Phase 17j: the street map. Listings anywhere in the world, loaded by visible area, never at an exact address.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withTenant } from "../../src/lib/db";
import { createAsset, setAssetPosition } from "../../src/lib/services/assets";
import { reviewListing, saveListingDraft, setListingStatus } from "../../src/lib/services/listings";
import { mapPlaces, mapView } from "../../src/lib/services/street-map";
import { newCompany, newPlatformAdmin } from "./helpers";

after(() => prisma.$disconnect());

test("the map shows published listings in view, at blurred positions, in any country", async () => {
  const co = await newCompany("map-a");
  const admin = await newPlatformAdmin();
  const tag = Date.now().toString(36);
  async function listed(name: string, city: string, state: string, pos: { lat: string; lng: string } | null, publish = true, extra: Record<string, unknown> = {}) {
    const a = await createAsset(co, { name, assetClass: "RESIDENTIAL", category: "House", companyRelationship: "OWNER", city, state } as never);
    if (pos) await setAssetPosition(co, a.id, pos);
    await saveListingDraft(co, a.id, { title: `${name} ${tag}`, purpose: "RENT", price: "3,000,000", city, state, bedrooms: "2", ...extra } as never);
    const l = await withTenant(co.companyId, co.userId, (tx) => tx.listing.findFirstOrThrow({ where: { assetId: a.id } }));
    if (publish) { await setListingStatus(co, a.id, "PENDING_REVIEW"); await reviewListing(admin.id, l.id, "approve", "ok"); }
    return withTenant(co.companyId, co.userId, (tx) => tx.listing.findFirstOrThrow({ where: { id: l.id } }));
  }
  const london = await listed("Camden flat", `Camden${tag}`, "London", { lat: "51.539123", lng: "-0.142456" });
  const lekki = await listed("Lekki terrace", "Lekki", "Lagos", null);
  const hidden = await listed("Draft in Camden", `Camden${tag}`, "London", { lat: "51.5401", lng: "-0.1433" }, false);
  const sale = await listed("Camden house for sale", `Camden${tag}`, "London", { lat: "51.5382", lng: "-0.1411" }, true, { purpose: "SALE", price: "900,000,000", bedrooms: "4" });

  // The public copy is blurred to about a kilometre, never the position the company set.
  assert.equal(london.lat, 51.54);
  assert.equal(london.lng, -0.14);
  // A listing without a set position sits at the centre of its named area, so it still appears on the map.
  assert.ok(lekki.lat !== null && Math.abs(lekki.lat - 6.45) < 0.2);

  const camden = { s: 51.5, w: -0.2, n: 51.58, e: -0.08 };
  const v = await mapView(camden, 14, {});
  const refs = v.markers.flatMap((m) => (m.kind === "pin" ? [m.ref] : []));
  assert.ok(refs.includes(london.publicRef));
  assert.ok(refs.includes(sale.publicRef));
  assert.ok(!refs.includes(hidden.publicRef), "drafts never appear");
  assert.ok(!refs.includes(lekki.publicRef), "only what is in view");
  const pin = v.markers.find((m) => m.kind === "pin" && m.ref === london.publicRef);
  assert.ok(pin && pin.kind === "pin" && pin.price === "3m" && pin.priceLabel.includes("3,000,000"));

  const rentOnly = await mapView(camden, 14, { purpose: "RENT" });
  assert.ok(!rentOnly.markers.some((m) => m.kind === "pin" && m.ref === sale.publicRef));
  const bigOnes = await mapView(camden, 14, { minBeds: "3" });
  assert.deepEqual(bigOnes.markers.flatMap((m) => (m.kind === "pin" ? [m.ref] : [])).filter((r) => [london.publicRef, sale.publicRef].includes(r)), [sale.publicRef]);
  const cheap = await mapView(camden, 14, { maxPrice: "5,000,000" });
  assert.ok(!cheap.markers.some((m) => m.kind === "pin" && m.ref === sale.publicRef));

  const places = await mapPlaces(`Camden${tag}`.slice(0, 12));
  assert.ok(places.some((p) => p.label.startsWith(`Camden${tag}`)));
  assert.ok((await mapPlaces("Lek")).some((p) => p.label.startsWith("Lekki")));
  assert.deepEqual(await mapPlaces("x"), [], "one letter is not a search");
});
