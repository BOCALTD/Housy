import { withTenant, withPublic, type Tx } from "../db";
import { logActivity } from "../audit";
import { validateUpload } from "../storage";
import { assertCan, type Ctx } from "./context";

export const MAX_LISTING_PHOTOS = 8;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** Editing what the public sees sends a published listing back to review, the same rule as editing its text. */
async function backToReview(tx: Tx, listing: { id: string; status: string; publishedAt: Date | null }) {
  if (listing.status === "PUBLISHED") await tx.listing.update({ where: { id: listing.id }, data: { status: "DRAFT", publishedAt: null } });
}

async function listingOf(tx: Tx, ctx: Ctx, assetId: string) {
  const listing = await tx.listing.findFirst({ where: { assetId, companyId: ctx.companyId } });
  if (!listing) throw new Error("Create the listing first, then add photographs");
  return listing;
}

export async function addListingPhoto(ctx: Ctx, assetId: string, file: { type: string; bytes: Uint8Array }, caption: string) {
  assertCan(ctx, "listing.manage");
  if (!IMAGE_TYPES.includes(file.type)) throw new Error("Upload a JPG, PNG or WEBP picture");
  validateUpload(file.type, file.bytes);
  const note = caption.trim().slice(0, 200);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const listing = await listingOf(tx, ctx, assetId);
    const existing = await tx.listingPhoto.findMany({ where: { listingId: listing.id }, select: { position: true }, orderBy: { position: "desc" } });
    if (existing.length >= MAX_LISTING_PHOTOS) throw new Error(`A listing can have up to ${MAX_LISTING_PHOTOS} photographs. Remove one first.`);
    const photo = await tx.listingPhoto.create({
      data: { companyId: ctx.companyId, listingId: listing.id, mimeType: file.type, bytes: Buffer.from(file.bytes), caption: note, position: existing.length ? existing[0].position + 1 : 0 },
      select: { id: true },
    });
    await backToReview(tx, listing);
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "listing", entityId: listing.id, action: "listing.photo_added", detail: { unpublished: listing.status === "PUBLISHED" } });
    return photo.id;
  });
}

export async function removeListingPhoto(ctx: Ctx, assetId: string, photoId: string) {
  assertCan(ctx, "listing.manage");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const listing = await listingOf(tx, ctx, assetId);
    const gone = await tx.listingPhoto.deleteMany({ where: { id: photoId, listingId: listing.id, companyId: ctx.companyId } });
    if (gone.count === 0) throw new Error("Photograph not found");
    await backToReview(tx, listing);
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "listing", entityId: listing.id, action: "listing.photo_removed", detail: {} });
  });
}

/** Make a photograph the cover (the front view shown on cards and on the promotion flyer). */
export async function makeCoverPhoto(ctx: Ctx, assetId: string, photoId: string) {
  assertCan(ctx, "listing.manage");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const listing = await listingOf(tx, ctx, assetId);
    const all = await tx.listingPhoto.findMany({ where: { listingId: listing.id }, select: { id: true }, orderBy: { position: "asc" } });
    if (!all.some((p) => p.id === photoId)) throw new Error("Photograph not found");
    const order = [photoId, ...all.map((p) => p.id).filter((id) => id !== photoId)];
    for (let i = 0; i < order.length; i++) await tx.listingPhoto.update({ where: { id: order[i] }, data: { position: i } });
    await backToReview(tx, listing);
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "listing", entityId: listing.id, action: "listing.photo_cover", detail: {} });
  });
}

/** Photographs of one listing for its owner company's screen (no picture bytes). */
export async function listingPhotosFor(ctx: Ctx, assetId: string) {
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const listing = await tx.listing.findFirst({ where: { assetId, companyId: ctx.companyId }, select: { id: true } });
    if (!listing) return [];
    return tx.listingPhoto.findMany({ where: { listingId: listing.id }, select: { id: true, caption: true, position: true }, orderBy: { position: "asc" } });
  });
}

/** The cover photograph of each listing, for cards. Only published listings are visible to the public. */
export async function coverPhotoIds(listingIds: string[]) {
  if (listingIds.length === 0) return new Map<string, string>();
  const rows = await withPublic((tx) => tx.listingPhoto.findMany({ where: { listingId: { in: listingIds } }, select: { id: true, listingId: true }, orderBy: { position: "asc" } }));
  const out = new Map<string, string>();
  for (const r of rows) if (!out.has(r.listingId)) out.set(r.listingId, r.id);
  return out;
}

/** Cover photographs looked up by public reference (for search results and sponsored cards). */
export async function coverPhotoIdsByRef(refs: string[]) {
  if (refs.length === 0) return new Map<string, string>();
  const rows = await withPublic((tx) => tx.listingPhoto.findMany({ where: { listing: { publicRef: { in: refs } } }, select: { id: true, listing: { select: { publicRef: true } } }, orderBy: { position: "asc" } }));
  const out = new Map<string, string>();
  for (const r of rows) if (!out.has(r.listing.publicRef)) out.set(r.listing.publicRef, r.id);
  return out;
}

/** The picture of one of the company's own listings, whatever its status (for the owner's screen). */
export async function ownListingPhotoBytes(ctx: Ctx, id: string) {
  return withTenant(ctx.companyId, ctx.userId, (tx) => tx.listingPhoto.findFirst({ where: { id, companyId: ctx.companyId }, select: { mimeType: true, bytes: true } }));
}

/** All photographs of a published listing, in order. */
export async function publicPhotosOf(listingId: string) {
  return withPublic((tx) => tx.listingPhoto.findMany({ where: { listingId }, select: { id: true, caption: true }, orderBy: { position: "asc" } }));
}

/** One picture for the public route. Row-level security returns nothing unless its listing is published. */
export async function publicPhotoBytes(id: string) {
  return withPublic((tx) => tx.listingPhoto.findFirst({ where: { id }, select: { mimeType: true, bytes: true } }));
}
