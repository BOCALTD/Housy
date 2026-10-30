// Data for the street map. The public sees published listings at a position blurred to about a kilometre (never an address);
// a company sees its own assets at the position it set. Requests ask only for what is inside the visible map area.
import type { Prisma } from "@prisma/client";
import { withPublic } from "../db";
import { PLACES, clusterCell, distanceKm, inBounds, shortMoney, type Bounds } from "../geo-rules";
import { circleBounds, distanceLabel } from "../location-rules";
import { priceSuffix } from "../listing-rules";
import { formatKobo } from "../money";
import { coverPhotoIds } from "./listing-photos";

export const MAP_MAX_PINS = 300;
export const MAP_LIST = 24;

export type MapFilters = { purpose?: string; maxPrice?: string; minBeds?: string; type?: string };
export type MapPin = { kind: "pin"; ref: string; lat: number; lng: number; price: string; title: string; priceLabel: string; beds: number | null; city: string; purpose: string; photo: string | null; distance?: string };
export type MapGroup = { kind: "group"; lat: number; lng: number; count: number; minPrice: string };

type Clean = { purpose: "SALE" | "RENT" | "LEASE" | null; max: bigint | null; beds: number | null; type: string | null };

function clean(f: MapFilters): Clean {
  const purpose = ["SALE", "RENT", "LEASE"].includes(f.purpose ?? "") ? (f.purpose as "SALE" | "RENT" | "LEASE") : null;
  let max: bigint | null = null;
  try { max = f.maxPrice ? BigInt(Math.round(Number(f.maxPrice.replace(/[,₦\s]/g, "")) * 100)) : null; } catch { max = null; }
  if (max !== null && max <= 0n) max = null;
  const b = f.minBeds ? Number.parseInt(f.minBeds, 10) : NaN;
  return { purpose, max, beds: Number.isInteger(b) && b > 0 ? b : null, type: f.type && /^[A-Z_]{2,40}$/.test(f.type) ? f.type : null };
}

function where(b: Bounds, c: Clean): Prisma.ListingWhereInput {
  return {
    status: "PUBLISHED",
    lat: { gte: b.s, lte: b.n }, lng: { gte: b.w, lte: b.e },
    ...(c.purpose ? { purpose: c.purpose } : {}),
    ...(c.max !== null ? { priceKobo: { lte: c.max } } : {}),
    ...(c.beds !== null ? { bedrooms: { gte: c.beds } } : {}),
    ...(c.type ? { propertyType: c.type } : {}),
  };
}

/**
 * What to draw for the visible area. With few listings in view, one pin each (with what a card needs); with many, groups by grid cell
 * so the browser never receives thousands of pins. Either way, the newest listings in view come back for the list beside the map.
 */
export async function mapView(b: Bounds, zoom: number, f: MapFilters) {
  const c = clean(f);
  const w = where(b, c);
  return withPublic(async (tx) => {
    const total = await tx.listing.count({ where: w });
    const select = { id: true, publicRef: true, title: true, priceKobo: true, pricePeriod: true, bedrooms: true, city: true, purpose: true, lat: true, lng: true } as const;
    const newest = await tx.listing.findMany({ where: w, select, orderBy: { publishedAt: "desc" }, take: total <= MAP_MAX_PINS ? MAP_MAX_PINS : MAP_LIST });
    const covers = await coverPhotoIds(newest.slice(0, total <= MAP_MAX_PINS ? MAP_MAX_PINS : MAP_LIST).map((l) => l.id));
    const pin = (l: (typeof newest)[number]): MapPin => ({
      kind: "pin", ref: l.publicRef, lat: l.lat!, lng: l.lng!, price: shortMoney(l.priceKobo), title: l.title, priceLabel: `${formatKobo(l.priceKobo)}${priceSuffix(l.pricePeriod)}`,
      beds: l.bedrooms, city: l.city, purpose: l.purpose, photo: covers.get(l.id) ?? null,
    });
    if (total <= MAP_MAX_PINS) return { total, markers: newest.map(pin), list: newest.slice(0, MAP_LIST).map(pin) };
    // Many listings: group them in the database by grid cell.
    const cell = clusterCell(zoom);
    const rows = await tx.$queryRaw<{ lat: number; lng: number; n: bigint; minp: bigint }[]>`
      SELECT avg(lat)::float8 AS lat, avg(lng)::float8 AS lng, count(*)::bigint AS n, min(price_kobo)::bigint AS minp
      FROM listings
      WHERE status = 'PUBLISHED' AND lat BETWEEN ${b.s} AND ${b.n} AND lng BETWEEN ${b.w} AND ${b.e}
        AND (${c.purpose}::text IS NULL OR purpose::text = ${c.purpose}::text)
        AND (${c.max}::bigint IS NULL OR price_kobo <= ${c.max}::bigint)
        AND (${c.beds}::int IS NULL OR bedrooms >= ${c.beds}::int)
        AND (${c.type}::text IS NULL OR property_type = ${c.type}::text)
      GROUP BY floor(lat / ${cell}), floor(lng / ${cell})
      LIMIT 2000`;
    const markers: MapGroup[] = rows.map((r) => ({ kind: "group", lat: r.lat, lng: r.lng, count: Number(r.n), minPrice: shortMoney(r.minp) }));
    return { total, markers, list: newest.map(pin) };
  });
}

/**
 * Radius search: published listings within km of a point, nearest first, with the distance on each card. Candidates come from
 * the box around the circle (indexed), then the exact distance decides. Beyond MAP_MAX_PINS results, they are grouped.
 */
export async function mapNear(centre: { lat: number; lng: number }, km: number, zoom: number, f: MapFilters) {
  const c = clean(f);
  const w = where(circleBounds(centre, km), c);
  return withPublic(async (tx) => {
    const rows = await tx.listing.findMany({ where: w, select: { id: true, publicRef: true, title: true, priceKobo: true, pricePeriod: true, bedrooms: true, city: true, purpose: true, lat: true, lng: true, publishedAt: true }, orderBy: { publishedAt: "desc" }, take: 3000 });
    const inside = rows.map((l) => ({ l, km: distanceKm(centre, { lat: l.lat!, lng: l.lng! }) })).filter((x) => x.km <= km).sort((a, b) => a.km - b.km);
    const listed = inside.slice(0, inside.length <= MAP_MAX_PINS ? MAP_MAX_PINS : MAP_LIST);
    const covers = await coverPhotoIds(listed.map((x) => x.l.id));
    const pin = ({ l, km: d }: (typeof inside)[number]): MapPin => ({
      kind: "pin", ref: l.publicRef, lat: l.lat!, lng: l.lng!, price: shortMoney(l.priceKobo), title: l.title, priceLabel: `${formatKobo(l.priceKobo)}${priceSuffix(l.pricePeriod)}`,
      beds: l.bedrooms, city: l.city, purpose: l.purpose, photo: covers.get(l.id) ?? null, distance: distanceLabel(d),
    });
    if (inside.length <= MAP_MAX_PINS) return { total: inside.length, markers: listed.map(pin), list: listed.slice(0, MAP_LIST).map(pin), near: { ...centre, km } };
    const cell = clusterCell(zoom);
    const groups = new Map<string, { lat: number; lng: number; n: number; minp: bigint }>();
    for (const { l } of inside) {
      const k = `${Math.floor(l.lat! / cell)}:${Math.floor(l.lng! / cell)}`;
      const g = groups.get(k) ?? { lat: 0, lng: 0, n: 0, minp: l.priceKobo };
      g.lat += l.lat!; g.lng += l.lng!; g.n += 1; if (l.priceKobo < g.minp) g.minp = l.priceKobo;
      groups.set(k, g);
    }
    const markers: MapGroup[] = [...groups.values()].map((g) => ({ kind: "group", lat: g.lat / g.n, lng: g.lng / g.n, count: g.n, minPrice: shortMoney(g.minp) }));
    return { total: inside.length, markers, list: listed.map(pin), near: { ...centre, km } };
  });
}

/** Places to jump to: the built-in list of Nigerian areas, plus any city with published listings anywhere. */
export async function mapPlaces(q: string) {
  const t = q.trim().toLowerCase();
  if (t.length < 2) return [];
  const builtIn = PLACES.filter((p) => p.name.toLowerCase().startsWith(t) || p.state.toLowerCase().startsWith(t)).slice(0, 6)
    .map((p) => ({ label: `${p.name}, ${p.state}`, lat: p.lat, lng: p.lng, zoom: p.kind === "STATE" ? 9 : p.kind === "CITY" ? 12 : 14 }));
  const cities = await withPublic((tx) => tx.listing.groupBy({
    by: ["city", "state", "country"], where: { status: "PUBLISHED", lat: { not: null }, OR: [{ city: { startsWith: q.trim(), mode: "insensitive" } }, { state: { startsWith: q.trim(), mode: "insensitive" } }] },
    _avg: { lat: true, lng: true }, _count: { _all: true }, orderBy: { _count: { city: "desc" } }, take: 8,
  }));
  const fromListings = cities.filter((c) => c._avg.lat !== null && c._avg.lng !== null).map((c) => ({ label: `${c.city}, ${c.state}${c.country !== "NG" ? `, ${c.country}` : ""}`, lat: c._avg.lat!, lng: c._avg.lng!, zoom: 12 }));
  const seen = new Set<string>();
  return [...fromListings, ...builtIn].filter((p) => { const k = p.label.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
}

/** The area around one listing, for the map on its page. */
export function listingArea(l: { lat: number | null; lng: number | null }) {
  return l.lat !== null && l.lng !== null ? { lat: l.lat, lng: l.lng } : null;
}

export { inBounds };
