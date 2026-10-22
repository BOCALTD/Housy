import { withPublic, withTenant } from "../db";
import { parseNairaToKobo } from "../money";
import { money } from "../api-rules";
import { parseAmenities } from "../listing-rules";
import type { Prisma } from "@prisma/client";

const PURPOSES = ["SALE", "RENT", "LEASE"] as const;

type L = { publicRef: string; title: string; purpose: string; pricePeriod: string; propertyType: string; negotiable: boolean; depositKobo: bigint | null; serviceChargeKobo: bigint | null; toilets: number | null; buildingSqm: number | null; landSqm: number | null; furnishing: string; constructionStatus: string; amenities: string; titleDocument: string; availableFrom: Date | null; priceKobo: bigint; bedrooms: number | null; bathrooms: number | null; description: string; city: string; state: string; lat: number | null; lng: number | null; publishedAt: Date | null; photos: { id: string; caption: string }[] };
const listingOut = (l: L, origin: string) => ({
  ref: l.publicRef, title: l.title, purpose: l.purpose, property_type: l.propertyType, price: money(l.priceKobo), price_period: l.pricePeriod, negotiable: l.negotiable,
  deposit: money(l.depositKobo), service_charge_per_year: money(l.serviceChargeKobo), bedrooms: l.bedrooms, bathrooms: l.bathrooms, toilets: l.toilets,
  building_sqm: l.buildingSqm, land_sqm: l.landSqm, furnishing: l.furnishing, construction_status: l.constructionStatus, amenities: parseAmenities(l.amenities),
  // As stated by the listing company. The platform does not verify title.
  title_document_stated: l.titleDocument, available_from: l.availableFrom?.toISOString().slice(0, 10) ?? null,
  description: l.description, city: l.city, state: l.state,
  // Only an approximate position (about 1 km) is ever published.
  approximate_location: l.lat != null && l.lng != null ? { lat: l.lat, lng: l.lng } : null,
  published_at: l.publishedAt?.toISOString() ?? null,
  photos: l.photos.map((p) => ({ url: `${origin}/photos/${p.id}`, caption: p.caption })),
  url: `${origin}/properties/${l.publicRef}`,
});
const listingSelect = { publicRef: true, title: true, purpose: true, pricePeriod: true, propertyType: true, negotiable: true, depositKobo: true, serviceChargeKobo: true, toilets: true, buildingSqm: true, landSqm: true, furnishing: true, constructionStatus: true, amenities: true, titleDocument: true, availableFrom: true, priceKobo: true, bedrooms: true, bathrooms: true, description: true, city: true, state: true, lat: true, lng: true, publishedAt: true, photos: { where: { kind: "PHOTO" }, select: { id: true, caption: true }, orderBy: { position: "asc" as const }, take: 8 } };

/** Published listings only. Row-level security gives nothing else to a program that is not signed in. */
export async function apiListings(params: URLSearchParams, skip: number, take: number, origin: string) {
  const purposeRaw = (params.get("purpose") ?? "").toUpperCase();
  const purpose = (PURPOSES as readonly string[]).includes(purposeRaw) ? purposeRaw : undefined;
  const city = (params.get("city") ?? "").trim().slice(0, 80);
  let maxKobo: bigint | undefined;
  try { maxKobo = params.get("max_price") ? parseNairaToKobo(params.get("max_price")!) : undefined; } catch { maxKobo = undefined; }
  const beds = Number.parseInt(params.get("min_bedrooms") ?? "", 10);
  const where: Prisma.ListingWhereInput = {
    status: "PUBLISHED",
    ...(purpose ? { purpose: purpose as (typeof PURPOSES)[number] } : {}),
    ...(city ? { OR: [{ city: { contains: city, mode: "insensitive" } }, { state: { contains: city, mode: "insensitive" } }] } : {}),
    ...(maxKobo !== undefined ? { priceKobo: { lte: maxKobo } } : {}),
    ...(Number.isInteger(beds) ? { bedrooms: { gte: beds } } : {}),
  };
  return withPublic(async (tx) => {
    const [total, rows] = await Promise.all([
      tx.listing.count({ where }),
      tx.listing.findMany({ where, orderBy: [{ publishedAt: "desc" }, { publicRef: "asc" }], skip, take, select: listingSelect }),
    ]);
    return { total, rows: rows.map((r) => listingOut(r, origin)) };
  });
}

export async function apiListing(ref: string, origin: string) {
  if (!/^[A-Za-z0-9-]{3,40}$/.test(ref)) return null;
  const l = await withPublic((tx) => tx.listing.findFirst({ where: { publicRef: ref, status: "PUBLISHED" }, select: listingSelect }));
  return l ? listingOut(l, origin) : null;
}

/** The calling company's own assets. Always limited to the key's company, with row-level security as the second line. */
export async function apiAssets(caller: { companyId: string; createdById: string }, skip: number, take: number) {
  return withTenant(caller.companyId, caller.createdById, async (tx) => {
    const where = { companyId: caller.companyId };
    const [total, rows] = await Promise.all([
      tx.asset.count({ where }),
      tx.asset.findMany({ where, orderBy: [{ createdAt: "desc" }, { ref: "asc" }], skip, take,
        select: { ref: true, name: true, assetClass: true, category: true, status: true, address: true, city: true, state: true, companyRelationship: true, createdAt: true, listing: { select: { publicRef: true, status: true } } } }),
    ]);
    return {
      total,
      rows: rows.map((a) => ({
        ref: a.ref, name: a.name, asset_class: a.assetClass, category: a.category, status: a.status, address: a.address, city: a.city, state: a.state,
        company_relationship: a.companyRelationship, created_at: a.createdAt.toISOString(),
        listing: a.listing ? { ref: a.listing.publicRef, status: a.listing.status } : null,
      })),
    };
  });
}
