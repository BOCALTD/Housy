import { prisma, withPublic, withPlatformAdmin, withTenant } from "../db";
import { MIN_AREA_COUNT, areaSafe, findPlace, locate, type MapPoint } from "../geo-rules";
import { formatKobo } from "../money";
import { assertCan, type Ctx } from "./context";

/**
 * Data for the maps. Three audiences, three levels of detail:
 *  - the public sees published listings, at an area about 1 km wide (or the centre of the city when no position is set);
 *  - a company sees its own assets, at the position it set;
 *  - vacancy sightings are never shown one by one except to the platform administrator. Managers see only counts for areas
 *    with enough sightings that none can be traced to a single address.
 */

export interface PublicMapFilters { purpose?: string; city?: string; maxPrice?: string; minBeds?: string }

export async function publicMapPoints(f: PublicMapFilters) {
  const purpose = ["SALE", "RENT", "LEASE"].includes(f.purpose ?? "") ? (f.purpose as "SALE" | "RENT" | "LEASE") : undefined;
  let maxKobo: bigint | undefined;
  try { maxKobo = f.maxPrice ? BigInt(Math.round(Number(f.maxPrice.replace(/,/g, "")) * 100)) : undefined; } catch { maxKobo = undefined; }
  if (maxKobo !== undefined && maxKobo <= 0n) maxKobo = undefined;
  const beds = f.minBeds ? Number.parseInt(f.minBeds, 10) : NaN;
  const rows = await withPublic((tx) => tx.listing.findMany({
    where: {
      status: "PUBLISHED",
      ...(purpose ? { purpose } : {}),
      ...(f.city ? { OR: [{ city: { contains: f.city, mode: "insensitive" } }, { state: { contains: f.city, mode: "insensitive" } }] } : {}),
      ...(maxKobo !== undefined ? { priceKobo: { lte: maxKobo } } : {}),
      ...(Number.isInteger(beds) ? { bedrooms: { gte: beds } } : {}),
    },
    select: { publicRef: true, title: true, city: true, state: true, purpose: true, priceKobo: true, bedrooms: true, lat: true, lng: true },
    orderBy: { publishedAt: "desc" }, take: 500,
  }));
  const points: MapPoint[] = [];
  let unplaced = 0;
  for (const l of rows) {
    const at = locate({ lat: l.lat, lng: l.lng, city: l.city, state: l.state });
    if (!at) { unplaced += 1; continue; }
    points.push({ id: l.publicRef, lat: at.lat, lng: at.lng, approximate: true, label: `${l.title} · ${formatKobo(l.priceKobo)}${l.purpose === "SALE" ? "" : " / year"}${l.bedrooms !== null ? ` · ${l.bedrooms} bed` : ""} · ${l.city}`, href: `/properties/${l.publicRef}`, group: l.purpose });
  }
  return { points, unplaced, total: rows.length };
}

export async function portfolioMapPoints(ctx: Ctx, f: { status?: string; assetClass?: string } = {}) {
  assertCan(ctx, "asset.view");
  const rows = await withTenant(ctx.companyId, ctx.userId, (tx) => tx.asset.findMany({
    where: { companyId: ctx.companyId, status: f.status && ["ACTIVE", "VACANT", "OCCUPIED", "UNDER_RENOVATION", "DISPOSED", "ARCHIVED"].includes(f.status) ? (f.status as never) : { notIn: ["DISPOSED", "ARCHIVED"] }, ...(f.assetClass && ["RESIDENTIAL", "COMMERCIAL", "LAND", "INDUSTRIAL", "PLANT_MACHINERY", "OTHER"].includes(f.assetClass) ? { assetClass: f.assetClass as never } : {}) },
    select: { id: true, ref: true, name: true, city: true, state: true, status: true, lat: true, lng: true }, orderBy: { ref: "asc" }, take: 2000,
  }));
  const points: MapPoint[] = [];
  let unplaced = 0;
  for (const a of rows) {
    const at = locate({ lat: a.lat, lng: a.lng, city: a.city, state: a.state });
    if (!at) { unplaced += 1; continue; }
    points.push({ id: a.id, lat: at.lat, lng: at.lng, approximate: at.approximate, label: `${a.ref} · ${a.name} · ${a.status.toLowerCase().replace(/_/g, " ")}`, href: `/app/assets/${a.id}`, group: a.status });
  }
  return { points, unplaced, total: rows.length };
}

export interface VacancyArea { area: string; state: string; count: number; lat: number; lng: number }

/** Counts of recent vacancy sightings by city, for areas with at least MIN_AREA_COUNT of them. Never a street, a description or a person. */
export async function vacancyAreas(ctx: Ctx, now = new Date()) {
  assertCan(ctx, "map.vacancies");
  const since = new Date(now.getTime() - 180 * 864e5);
  const groups = await withPlatformAdmin("system", (tx) => tx.vacancyReport.groupBy({ by: ["city", "state"], where: { createdAt: { gte: since }, outcome: { in: ["OPEN", "APPROVED", "NEEDS_INFO"] } }, _count: { _all: true } }));
  // Different spellings of one city are counted together.
  const merged = new Map<string, VacancyArea>();
  let hidden = 0;
  for (const g of groups) {
    const place = findPlace(g.city) ?? findPlace(g.state);
    if (!place) { hidden += g._count._all; continue; }
    const key = `${place.name}|${place.state}`;
    const cur = merged.get(key);
    if (cur) cur.count += g._count._all; else merged.set(key, { area: place.name, state: place.state, count: g._count._all, lat: place.lat, lng: place.lng });
  }
  const all = [...merged.values()];
  const safe = all.filter((a) => areaSafe(a.count)).sort((a, b) => b.count - a.count);
  hidden += all.filter((a) => !areaSafe(a.count)).reduce((n, a) => n + a.count, 0);
  const points: MapPoint[] = safe.map((a) => ({ id: `${a.area}-${a.state}`, lat: a.lat, lng: a.lng, approximate: true, weight: a.count, label: `${a.area}, ${a.state}: ${a.count} recent sightings`, group: "VACANCY" }));
  return { areas: safe, points, hiddenReports: hidden, minimum: MIN_AREA_COUNT };
}

/** Every sighting with a position, for the platform administrator only. */
export async function vacancyPins(adminId: string) {
  const u = await prisma.user.findUnique({ where: { id: adminId }, select: { isPlatformAdmin: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
  const rows = await withPlatformAdmin(adminId, (tx) => tx.vacancyReport.findMany({ where: { outcome: { in: ["OPEN", "APPROVED", "NEEDS_INFO"] } }, select: { id: true, ref: true, propertyType: true, area: true, city: true, state: true, lat: true, lng: true, stage: true }, orderBy: { createdAt: "desc" }, take: 1000 }));
  const points: MapPoint[] = [];
  let unplaced = 0;
  for (const r of rows) {
    const at = locate({ lat: r.lat, lng: r.lng, area: r.area, city: r.city, state: r.state });
    if (!at) { unplaced += 1; continue; }
    points.push({ id: r.id, lat: at.lat, lng: at.lng, approximate: at.approximate, label: `${r.ref} · ${r.propertyType} · ${r.area || r.city} · ${r.stage.toLowerCase().replace(/_/g, " ")}`, href: `/admin/vacancies/${r.id}`, group: r.stage });
  }
  return { points, unplaced, total: rows.length };
}
