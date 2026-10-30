/**
 * Prompts for the administrator reviewing listings (listing-risk-rules.ts): run as the platform over listings waiting for review.
 * Nothing here approves, returns or hides a listing; the reviewer decides and the flags are shown beside the listing.
 */
import { withPlatformAdmin } from "../db";
import { bedroomBand, segmentOf, yearlyKobo } from "../market-rules";
import { descriptionKey, priceFlag, sortFlags, textFlags, type RiskFlag } from "../listing-risk-rules";
import { marketOverview } from "./market";

const NEW_COMPANY_DAYS = 14;
const BURST = 15;

type L = { id: string; companyId: string; title: string; description: string; feesNote: string; purpose: string; pricePeriod: string; priceKobo: bigint; bedrooms: number | null; propertyType: string; city: string };

export async function listingRiskFlags(adminUserId: string, listings: L[]): Promise<Map<string, RiskFlag[]>> {
  const out = new Map<string, RiskFlag[]>(listings.map((l) => [l.id, textFlags(l)]));
  if (!listings.length) return out;
  const ids = listings.map((l) => l.id);
  const companyIds = [...new Set(listings.map((l) => l.companyId))];
  const keys = listings.map((l) => descriptionKey(l.description));

  const [photoReuse, copied, companies, recent, market] = await Promise.all([
    withPlatformAdmin(adminUserId, (tx) => tx.$queryRaw<{ listing_id: string; others: bigint }[]>`
      SELECT p.listing_id, count(DISTINCT o.company_id)::bigint AS others
      FROM listing_photos p JOIN listing_photos o ON o.content_hash = p.content_hash AND o.company_id <> p.company_id
      WHERE p.listing_id = ANY(${ids}::text[]) AND p.content_hash IS NOT NULL
      GROUP BY p.listing_id`),
    keys.some(Boolean) ? withPlatformAdmin(adminUserId, (tx) => tx.$queryRaw<{ key: string; company_id: string }[]>`
      SELECT DISTINCT lower(regexp_replace(trim(description), '\\s+', ' ', 'g')) AS key, company_id FROM listings
      WHERE lower(regexp_replace(trim(description), '\\s+', ' ', 'g')) = ANY(${keys.filter((k): k is string => !!k)}::text[])`) : Promise.resolve([]),
    withPlatformAdmin(adminUserId, (tx) => tx.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, createdAt: true } })),
    withPlatformAdmin(adminUserId, (tx) => tx.listing.groupBy({ by: ["companyId"], where: { companyId: { in: companyIds }, updatedAt: { gte: new Date(Date.now() - 864e5) }, status: "PENDING_REVIEW" }, _count: { _all: true } })),
    marketOverview().catch(() => null),
  ]);

  const reuse = new Map(photoReuse.map((r) => [r.listing_id, Number(r.others)]));
  for (const [i, l] of listings.entries()) {
    const f = out.get(l.id)!;
    const n = reuse.get(l.id) ?? 0;
    if (n > 0) f.push({ code: "PHOTO_REUSED", level: "high", text: `${n === 1 ? "A photo is" : "Photos are"} also used by ${n} other compan${n === 1 ? "y" : "ies"}'s listing. Check who owns the property.` });
    const k = keys[i];
    if (k && copied.some((c) => c.key === k && c.company_id !== l.companyId)) f.push({ code: "TEXT_COPIED", level: "medium", text: "The description matches word for word a listing from another company." });
    const co = companies.find((c) => c.id === l.companyId);
    if (co) {
      const days = Math.floor((Date.now() - co.createdAt.getTime()) / 864e5);
      if (days < NEW_COMPANY_DAYS) f.push({ code: "NEW_COMPANY", level: "medium", text: `The company joined ${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}.` });
    }
    const burst = recent.find((r) => r.companyId === l.companyId)?._count._all ?? 0;
    if (burst >= BURST) f.push({ code: "BURST", level: "medium", text: `${burst} listings sent for review by this company in the last day.` });
    if (market && segmentOf(l.propertyType) === "HOME" && (l.purpose === "SALE" || l.purpose === "RENT")) {
      const city = market.cities.find((c) => c.city.toLowerCase() === l.city.trim().toLowerCase());
      const band = city?.byBedrooms.find((b) => b.band === bedroomBand(l.bedrooms));
      const y = yearlyKobo(l);
      const s = l.purpose === "SALE" ? band?.sale : band?.rent;
      if (s && y !== null) {
        const p = priceFlag(Number(y) / 100, s, `${band!.band}-bedroom homes ${l.purpose === "SALE" ? "for sale" : "to rent a year"} in ${city!.city}`);
        if (p) f.push(p);
      }
    }
    out.set(l.id, sortFlags(f));
  }
  return out;
}
