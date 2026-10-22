import { referralEvent } from "./referrals";
import { alertNewListing, alertWatchers, notifyEnquiry } from "./alerts";
import { vacancyListingPublished } from "./vacancies";
import { z } from "zod";
import { publicPosition } from "../geo-rules";
import { withTenant, withPublic, withPlatformAdmin } from "../db";
import { logActivity } from "../audit";
import { parseNairaToKobo } from "../money";
import { randomRef } from "../tokens";
import { rateLimit } from "../ratelimit";
import { assertCan, type Ctx } from "./context";
import type { Prisma } from "@prisma/client";
import {
  CONDITIONS, CONSTRUCTION, FURNISHING, PRICE_PERIODS, PROPERTY_TYPES, SEARCH_PAGE, TITLE_DOCUMENTS, defaultPeriod, isCode, joinAmenities,
  type CategoryRule, type Filters, type PricePeriod,
} from "../listing-rules";

export const PURPOSES = ["SALE", "RENT", "LEASE"] as const;

const optInt = (label: string, max: number) => z.string().optional().transform((v) => (v && v.trim() ? Number.parseInt(v.replace(/[,\s]/g, ""), 10) : null))
  .refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= max), `Enter a valid ${label}`);
const optMoney = z.string().optional().transform((v) => (v && v.trim() ? parseNairaToKobo(v) : null));
const code = <T extends Record<string, string>>(table: T, fallback: keyof T) => z.string().optional().transform((v) => (v && isCode(table, v) ? (v as keyof T) : fallback));

const listingSchema = z.object({
  title: z.string().trim().min(5, "Enter a listing title of at least 5 characters").max(160),
  purpose: z.enum(PURPOSES),
  price: z.string().transform((v) => parseNairaToKobo(v)),
  bedrooms: optInt("number of bedrooms", 99),
  bathrooms: optInt("number of bathrooms", 99),
  description: z.string().trim().max(5000).default(""),
  city: z.string().trim().min(2, "Enter the city or area").max(80),
  state: z.string().trim().min(2, "Enter the state").max(80),
  // Details (all optional, so older forms and imports still work).
  propertyType: code(PROPERTY_TYPES, "OTHER"),
  pricePeriod: z.string().optional(),
  negotiable: z.union([z.boolean(), z.string()]).optional().transform((v) => v === true || v === "yes" || v === "on"),
  deposit: optMoney, serviceCharge: optMoney,
  feesNote: z.string().trim().max(500).optional().default(""),
  toilets: optInt("number of toilets", 99), floors: optInt("number of floors", 200),
  buildingSqm: optInt("building size in square metres", 10_000_000), landSqm: optInt("land size in square metres", 100_000_000),
  plotDimensions: z.string().trim().max(60).optional().default(""),
  furnishing: code(FURNISHING, "UNSPECIFIED"), condition: code(CONDITIONS, "UNSPECIFIED"), constructionStatus: code(CONSTRUCTION, "COMPLETED"),
  serviced: z.union([z.boolean(), z.string()]).optional().transform((v) => v === true || v === "yes" || v === "on"),
  amenities: z.array(z.string()).optional().default([]),
  titleDocument: code(TITLE_DOCUMENTS, "UNSPECIFIED"),
  availableFrom: z.string().optional().transform((v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null)),
  minLeaseMonths: optInt("minimum lease length in months", 1200),
  estateName: z.string().trim().max(120).optional().default(""),
  videoUrl: z.string().trim().max(300).optional().default("")
    .refine((v) => v === "" || /^https:\/\/(www\.)?(youtube\.com|youtu\.be|vimeo\.com)\//.test(v), "The video must be a YouTube or Vimeo link starting with https://"),
}).transform((d) => {
  const period = d.purpose === "SALE" ? "TOTAL" : d.pricePeriod && isCode(PRICE_PERIODS, d.pricePeriod) && d.pricePeriod !== "TOTAL" ? d.pricePeriod : defaultPeriod(d.purpose);
  return { ...d, pricePeriod: period as PricePeriod, amenities: joinAmenities(d.amenities) };
}).refine((d) => d.minLeaseMonths === null || d.purpose !== "SALE", { message: "A minimum lease length only applies to rent or lease" });

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
    const shown = asset.lat !== null && asset.lng !== null ? publicPosition(asset.lat, asset.lng) : null;
    const fields = {
      title: data.title, purpose: data.purpose, priceKobo: data.price, bedrooms: data.bedrooms,
      bathrooms: data.bathrooms, description: data.description, city: data.city, state: data.state,
      lat: shown?.lat ?? null, lng: shown?.lng ?? null,
      propertyType: data.propertyType as string, pricePeriod: data.pricePeriod, negotiable: data.negotiable, depositKobo: data.deposit, serviceChargeKobo: data.serviceCharge,
      feesNote: data.feesNote, toilets: data.toilets, floors: data.floors, buildingSqm: data.buildingSqm, landSqm: data.landSqm, plotDimensions: data.plotDimensions,
      furnishing: data.furnishing as string, condition: data.condition as string, constructionStatus: data.constructionStatus as string, serviced: data.serviced,
      amenities: data.amenities, titleDocument: data.titleDocument as string, availableFrom: data.availableFrom, minLeaseMonths: data.minLeaseMonths,
      estateName: data.estateName, videoUrl: data.videoUrl,
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

/** Turn filters (and a category's rule) into a database query. Only published listings, always. */
export function listingWhere(f: Filters, rule: CategoryRule = {}, companyIds?: string[]): Prisma.ListingWhereInput {
  const and: Prisma.ListingWhereInput[] = [{ status: "PUBLISHED" }];
  if (rule.purpose) and.push({ purpose: { in: rule.purpose } });
  if (rule.types) and.push({ propertyType: { in: rule.types } });
  if (rule.period) and.push({ pricePeriod: { in: rule.period } });
  if (rule.notPeriod) and.push({ pricePeriod: { notIn: rule.notPeriod } });
  if (rule.construction) and.push({ constructionStatus: { in: rule.construction } });
  if (f.purpose) and.push({ purpose: f.purpose });
  if (f.types.length) and.push({ propertyType: { in: f.types } });
  if (f.period) and.push({ pricePeriod: f.period });
  if (f.city) and.push({ OR: [{ city: { contains: f.city, mode: "insensitive" } }, { state: { contains: f.city, mode: "insensitive" } }] });
  if (f.q) and.push({ OR: [{ title: { contains: f.q, mode: "insensitive" } }, { description: { contains: f.q, mode: "insensitive" } }, { estateName: { contains: f.q, mode: "insensitive" } }] });
  const money = (v?: string) => { try { return v ? parseNairaToKobo(v) : undefined; } catch { return undefined; } };
  const min = money(f.minPrice), max = money(f.maxPrice);
  if (min !== undefined || max !== undefined) and.push({ priceKobo: { ...(min !== undefined ? { gte: min } : {}), ...(max !== undefined ? { lte: max } : {}) } });
  if (f.minBeds !== undefined) and.push({ bedrooms: { gte: f.minBeds } });
  if (f.minBaths !== undefined) and.push({ bathrooms: { gte: f.minBaths } });
  if (f.furnishing) and.push({ furnishing: f.furnishing });
  if (f.serviced) and.push({ serviced: true });
  if (f.negotiable) and.push({ negotiable: true });
  for (const a of f.amenities) and.push({ OR: [{ amenities: a }, { amenities: { startsWith: `${a},` } }, { amenities: { endsWith: `,${a}` } }, { amenities: { contains: `,${a},` } }] });
  if (f.minSize !== undefined) and.push({ OR: [{ buildingSqm: { gte: f.minSize } }, { landSqm: { gte: f.minSize } }] });
  if (f.construction) and.push({ constructionStatus: f.construction });
  if (f.titleDoc) and.push({ titleDocument: f.titleDoc });
  if (f.estate) and.push({ estateName: { contains: f.estate, mode: "insensitive" } });
  if (f.availableBy) and.push({ OR: [{ availableFrom: null }, { availableFrom: { lte: new Date(`${f.availableBy}T00:00:00Z`) } }] });
  if (companyIds) and.push({ companyId: { in: companyIds } });
  return { AND: and };
}

const ORDER: Record<Filters["sort"], Prisma.ListingOrderByWithRelationInput[]> = {
  newest: [{ publishedAt: "desc" }, { publicRef: "asc" }],
  price_asc: [{ priceKobo: "asc" }, { publicRef: "asc" }],
  price_desc: [{ priceKobo: "desc" }, { publicRef: "asc" }],
  size_desc: [{ buildingSqm: { sort: "desc", nulls: "last" } }, { landSqm: { sort: "desc", nulls: "last" } }, { publicRef: "asc" }],
};

/** One page of search results with the total, for the browse and category pages. */
export async function searchListingsPage(f: Filters, rule: CategoryRule = {}, companyIds?: string[]) {
  const where = listingWhere(f, rule, companyIds);
  return withPublic(async (tx) => {
    const [total, rows] = await Promise.all([
      tx.listing.count({ where }),
      tx.listing.findMany({ where, orderBy: ORDER[f.sort], skip: (f.page - 1) * SEARCH_PAGE, take: SEARCH_PAGE }),
    ]);
    return { total, pages: Math.max(1, Math.ceil(total / SEARCH_PAGE)), rows };
  });
}

/** How many published listings each category has (for the browse tiles). */
export async function categoryCounts(rules: { slug: string; rule: CategoryRule }[]) {
  const empty: Filters = { types: [], amenities: [], sort: "newest", page: 1 };
  return withPublic(async (tx) => Object.fromEntries(await Promise.all(rules.map(async (c) => [c.slug, await tx.listing.count({ where: listingWhere(empty, c.rule) })] as const))));
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
