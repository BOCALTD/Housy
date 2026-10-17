/**
 * Phase 17a: photographs of listings. Only people in the owning company can add or remove them; the public sees them only while
 * the listing is published; changing them sends a live listing back to review; there is a limit per listing; and the cover is the first one.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withTenant } from "../../src/lib/db";
import { withPlatformAdmin } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { saveListingDraft, setListingStatus, reviewListing } from "../../src/lib/services/listings";
import { MAX_LISTING_PHOTOS, addListingPhoto, coverPhotoIds, listingPhotosFor, makeCoverPhoto, publicPhotoBytes, publicPhotosOf, removeListingPhoto } from "../../src/lib/services/listing-photos";
import { addMember, newCompany, newPlatformAdmin } from "./helpers";

after(() => prisma.$disconnect());

// A tiny valid PNG header is enough: the app checks the type and the first bytes.
const png = (n = 0) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n, 1, 2, 3]);

async function liveListing(tag: string) {
  const admin = await newCompany(tag);
  const asset = await createAsset(admin, { name: `Villa ${tag}`, assetClass: "RESIDENTIAL", category: "House", companyRelationship: "OWNER" } as never);
  await saveListingDraft(admin, asset.id, { title: `Villa for sale ${tag}`, purpose: "SALE", price: "50,000,000", bedrooms: "3", bathrooms: "2", description: "", city: "Lagos", state: "Lagos" });
  await setListingStatus(admin, asset.id, "PENDING_REVIEW");
  const platform = await newPlatformAdmin();
  const listing = await withPlatformAdmin(platform.id, (tx) => tx.listing.findFirstOrThrow({ where: { assetId: asset.id } }));
  await reviewListing(platform.id, listing.id, "approve", "ok");
  return { admin, asset, listing, platformId: platform.id };
}

test("photographs: the public sees them only while the listing is published", async () => {
  const { admin, asset, listing, platformId } = await liveListing("lp1");
  const first = await addListingPhoto(admin, asset.id, { type: "image/png", bytes: png(1) }, "Front view");
  // Adding to a live listing sends it back to review, so the public sees nothing yet.
  assert.equal((await publicPhotosOf(listing.id)).length, 0);
  assert.equal(await publicPhotoBytes(first), null);
  const state = await withTenant(admin.companyId, admin.userId, (tx) => tx.listing.findFirstOrThrow({ where: { id: listing.id } }));
  assert.equal(state.status, "DRAFT");
  await setListingStatus(admin, asset.id, "PENDING_REVIEW");
  await reviewListing(platformId, listing.id, "approve", "ok");
  assert.equal((await publicPhotosOf(listing.id)).length, 1);
  assert.equal((await publicPhotoBytes(first))?.mimeType, "image/png");
  assert.equal((await coverPhotoIds([listing.id])).get(listing.id), first);
});

test("photographs: strangers cannot add or remove, bad files are refused, the number is limited, and the cover can change", async () => {
  const { admin, asset, listing } = await liveListing("lp2");
  const other = await newCompany("lp2x");
  const clerk = await addMember(admin, "OFFICER", "lpc");
  await assert.rejects(addListingPhoto(clerk, asset.id, { type: "image/png", bytes: png() }, ""), /./);
  await assert.rejects(addListingPhoto(other, asset.id, { type: "image/png", bytes: png() }, ""), /Create the listing first|not found/i);
  await assert.rejects(addListingPhoto(admin, asset.id, { type: "application/pdf", bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 1]) }, ""), /JPG, PNG or WEBP/);
  await assert.rejects(addListingPhoto(admin, asset.id, { type: "image/png", bytes: new Uint8Array([1, 2, 3, 4]) }, ""), /./);

  const ids: string[] = [];
  for (let i = 0; i < MAX_LISTING_PHOTOS; i++) ids.push(await addListingPhoto(admin, asset.id, { type: "image/png", bytes: png(i) }, `Picture ${i}`));
  await assert.rejects(addListingPhoto(admin, asset.id, { type: "image/png", bytes: png(99) }, ""), /up to 8/);
  await assert.rejects(removeListingPhoto(other, asset.id, ids[0]), /Create the listing first|not found/i);

  await makeCoverPhoto(admin, asset.id, ids[3]);
  const order = (await listingPhotosFor(admin, asset.id)).map((p) => p.id);
  assert.equal(order[0], ids[3]);
  assert.equal(order.length, MAX_LISTING_PHOTOS);
  await removeListingPhoto(admin, asset.id, ids[3]);
  assert.equal((await listingPhotosFor(admin, asset.id)).length, MAX_LISTING_PHOTOS - 1);
  void listing;
});
