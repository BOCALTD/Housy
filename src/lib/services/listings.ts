import { referralEvent } from "./referrals";
import { alertNewListing, alertWatchers, notifyEnquiry } from "./alerts";
import { vacancyListingPublished } from "./vacancies";
import { z } from "zod";
import { withTenant, withPublic, withPlatformAdmin } from "../db";
import { logActivity } from "../audit";
import { parseNairaToKobo } from "../money";
import { randomRef } from "../tokens";
import { rateLimit } from "../ratelimit";
import { assertCan, type Ctx } from "./context";

export const PURPOSES = ["SALE", "RENT", "LEASE"] as const;

const listingSchema = z.object({
  title: z.string().trim().min(5, "Enter a listing title of at least 5 characters").max(160),
  purpose: z.enum(PURPOSES),
  price: z.string().transform((v) => parseNairaToKobo(v)),
  bedrooms: z.string().optional().transform((v) => (v ? Number.parseInt(v, 10) : null))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v < 100), "Enter a valid number of bedrooms"),
  bathrooms: z.string().optional().transform((v) => (v ? Number.parseInt(v, 10) : null))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v < 100), "Enter a valid number of bathrooms"),
  description: z.string().trim().max(5000).default(""),
  city: z.string().trim().min(2, "Enter the city or area").max(80),
  state: z.string().trim().min(2, "Enter the state").max(80),
});

/**
 * Create or edit the draft listing for an asset. Editing a published listing sends it back to review,
 * so unreviewed changes never appear publicly.
 */
export async function saveListingDraft(ctx: Ctx, assetId: string, input: z.input<typeof listingSchema>) {
  assertCan(ctx, "listing.manage");
  const data = listingSchema.parse(input);
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const asset = await tx.asset.findFirst({ where: { id: assetId, companyId: ctx.companyId }, include: { listing: true } });
    if (!asset) throw new Error("Asset not found");
    if (asset.status === "DISPOSED" || asset.status === "ARCHIVED") throw new Error("Disposed or archived assets cannot be listed");
    const fields = {
      title: data.title, purpose: data.purpose, priceKobo: data.price, bedrooms: data.bedrooms,
      bathrooms: data.bathrooms, description: data.description, city: data.city, state: data.state,
    };
    if (asset.listing) {
      const wasPublished = asset.listing.status === "PUBLISHED";
      await tx.listing.update({
        where: { id: asset.listing.id },
        data: { ...fields, status: "DRAFT", publishedAt: wasPublished ? null : asset.listing.publishedAt },
      });
      await logActivity(tx, {
        companyId: ctx.companyId, actorId: ctx.userId, entityType: "listing", entityId: asset.listing.id,
        action: "listing.edited", detail: { unpublished: wasPublished },
      });
    } else {
      const listing = await tx.listing.create({
        data: { ...fields, companyId: ctx.companyId, assetId, publicRef: randomRef("PROP"), postedById: ctx.userId },
      });
      await logActivity(tx, {
        companyId: ctx.companyId, actorId: ctx.userId, entityType: "listing", entityId: listing.id,
        action: "listing.drafted", detail: { publicRef: listing.publicRef },
      });
    }
  });
}

export async function setListingStatus(ctx: Ctx, assetId: string, to: "PENDING_REVIEW" | "UNAVAILABLE" | "DRAFT") {
  assertCan(ctx, "listing.manage");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const listing = await tx.listing.findFirst({ where: { assetId, companyId: ctx.companyId } });
    if (!listing) throw new Error("Create the listing first");
    const allowed: Record<string, string[]> = {
      PENDING_REVIEW: ["DRAFT", "UNAVAILABLE"],
      UNAVAILABLE: ["PUBLISHED"],
      DRAFT: ["PENDING_REVIEW"],
    };
    if (!allowed[to].includes(listing.status)) {
      throw new Error(`A listing that is ${listing.status.replace("_", " ").toLowerCase()} cannot move to ${to.replace("_", " ").toLowerCase()}`);
    }
    await tx.listing.update({ where: { id: listing.id }, data: { status: to } });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "listing", entityId: listing.id,
      action: "listing.status_changed", detail: { from: listing.status, to },
    });
    return listing;
  }).then(async (listing) => {
    if (to === "UNAVAILABLE") { try { await alertWatchers(listing.id, "No longer available"); } catch (e) { console.error("watcher alert failed", e); } }
  });
}

// ---------- Platform review ----------

export async function reviewQueue(adminUserId: string) {
  return withPlatformAdmin(adminUserId, async (tx) => {
    const listings = await tx.listing.findMany({ where: { status: "PENDING_REVIEW" }, orderBy: { updatedAt: "asc" } });
    const companies = await tx.company.findMany({
      where: { id: { in: listings.map((l) => l.companyId) } }, select: { id: true, name: true },
    });
    const names = Object.fromEntries(companies.map((c) => [c.id, c.name]));
    return listings.map((l) => ({ ...l, companyName: names[l.companyId] ?? "Unknown company" }));
  });
}

export async function reviewListing(adminUserId: string, listingId: string, decision: "approve" | "reject", note: string) {
  if (decision === "reject" && note.trim().length < 3) throw new Error("Give the company a reason for rejecting the listing");
  const published = await withPlatformAdmin(adminUserId, async (tx) => {
    const listing = await tx.listing.findUnique({ where: { id: listingId } });
    if (!listing || listing.status !== "PENDING_REVIEW") throw new Error("That listing is not awaiting review");
    const status = decision === "approve" ? "PUBLISHED" : "DRAFT";
    await tx.listing.update({
      where: { id: listing.id },
      data: { status, reviewNote: note.trim(), publishedAt: decision === "approve" ? new Date() : null },
    });
    await logActivity(tx, {
      companyId: listing.companyId, actorId: adminUserId, entityType: "listing", entityId: listing.id,
      action: decision === "approve" ? "listing.approved" : "listing.rejected", detail: { note: note.trim() },
    });
    return decision === "approve" ? { companyId: listing.companyId, id: listing.id, title: listing.title } : null;
  });
  if (published) await vacancyListingPublished(published.id);
  if (published) await referralEvent("REFERRAL_LISTING_PUBLISHED", { companyId: published.companyId }, { type: "listing", id: published.id, label: published.title });
  // Tell the people who asked for it. A failure here must never undo the approval.
  if (published) {
    try {
      const r = await alertNewListing(published.id);
      if (r.skipped === "already announced") await alertWatchers(published.id, "Available again");
    } catch (e) { console.error("property alert failed", e); }
  }
}

// ---------- Public marketplace ----------

export type SearchFilters = { q?: string; purpose?: string; city?: string; maxPrice?: string; minBeds?: string };

export async function searchListings(f: SearchFilters) {
  const purpose = (PURPOSES as readonly string[]).includes(f.purpose ?? "") ? (f.purpose as (typeof PURPOSES)[number]) : undefined;
  let maxKobo: bigint | undefined;
  try { maxKobo = f.maxPrice ? parseNairaToKobo(f.maxPrice) : undefined; } catch { maxKobo = undefined; }
  const minBeds = f.minBeds ? Number.parseInt(f.minBeds, 10) : NaN;
  return withPublic((tx) =>
    tx.listing.findMany({
      where: {
        status: "PUBLISHED",
        ...(purpose ? { purpose } : {}),
        ...(f.city ? { OR: [{ city: { contains: f.city, mode: "insensitive" } }, { state: { contains: f.city, mode: "insensitive" } }] } : {}),
        ...(f.q ? { title: { contains: f.q, mode: "insensitive" } } : {}),
        ...(maxKobo !== undefined ? { priceKobo: { lte: maxKobo } } : {}),
        ...(Number.isInteger(minBeds) ? { bedrooms: { gte: minBeds } } : {}),
      },
      orderBy: { publishedAt: "desc" },
      take: 60,
    }),
  );
}

export async function getPublicListing(publicRef: string) {
  return withPublic((tx) => tx.listing.findFirst({ where: { publicRef, status: "PUBLISHED" } }));
}

const enquirySchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(120),
  contact: z.string().trim().min(5, "Enter a phone number or email address").max(200),
  message: z.string().trim().min(5, "Write a short message").max(2000),
});

/** A public enquiry, recorded against the listing's company. */
/** `attribution` says the visitor arrived through an advert; it counts only if that visitor really clicked it. */
export async function createEnquiry(publicRef: string, input: z.input<typeof enquirySchema>, clientKey: string, attribution?: { adRef: string; viewerKey: string }) {
  if (!(await rateLimit(`enquiry:${clientKey}`, 10, 60 * 60 * 1000))) throw new Error("Too many enquiries. Try again later.");
  const data = enquirySchema.parse(input);
  const listing = await getPublicListing(publicRef);
  if (!listing) throw new Error("This property is no longer available");
  let adCampaignId: string | null = null;
  if (attribution) {
    try { adCampaignId = await (await import("./ads")).attributeEnquiry(listing.id, attribution.adRef, attribution.viewerKey); } catch (e) { console.error("enquiry attribution failed", e); }
  }
  // The company context comes from the published listing, never from the visitor.
  await withTenant(listing.companyId, "", async (tx) => {
    const enquiry = await tx.enquiry.create({
      data: { companyId: listing.companyId, listingId: listing.id, name: data.name, contact: data.contact, message: data.message, adCampaignId },
    });
    await logActivity(tx, {
      companyId: listing.companyId, actorId: null, entityType: "listing", entityId: listing.id,
      action: "enquiry.received", detail: { enquiryId: enquiry.id },
    });
  });
  try { await notifyEnquiry(listing, data.name, data.message); } catch (e) { console.error("enquiry notice failed", e); }
}
