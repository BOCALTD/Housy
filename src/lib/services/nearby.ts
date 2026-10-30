/**
 * Nearby places and travel times for a property, from public map data.
 * - Nearby: OpenStreetMap data through an Overpass server (OVERPASS_URL; the public server by default, which allows
 *   reasonable use). One lookup covers a square kilometre and is kept for 30 days in nearby_cache, so a busy site makes few
 *   requests; a failed lookup is remembered for an hour. Set NEARBY_PLACES=off to switch it off.
 * - Travel time: an estimate from the distance, or real driving times when ROUTING_URL points at an OSRM-compatible server.
 * Only the property's public position (blurred to about a kilometre) is ever sent out, never an address or a person's data.
 */
import { prisma, withPublic } from "../db";
import { nearbyCell, overpassQuery, parseOverpass, parseRoute, summariseNearby, travelEstimate, type Amenity } from "../location-rules";

const DAY = 864e5;
const TTL_OK = 30 * DAY, TTL_FAIL = 3_600_000;
const TIMEOUT_MS = 20_000;

type Env = Record<string, string | undefined>;
let fetcher: typeof fetch = (...a) => fetch(...a);
/** Tests replace the network. */
export function setNearbyFetchForTests(f: typeof fetch | null) { fetcher = f ?? ((...a) => fetch(...a)); }

async function timed(url: string, init?: RequestInit) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try { return await fetcher(url, { ...init, signal: ctrl.signal, cache: "no-store" }); } finally { clearTimeout(t); }
}

/** The public position of a published listing, or null. */
async function listingPoint(ref: string) {
  return withPublic((tx) => tx.listing.findFirst({ where: { publicRef: ref, status: "PUBLISHED", lat: { not: null } }, select: { lat: true, lng: true } }))
    .then((l) => (l && l.lat !== null && l.lng !== null ? { lat: l.lat, lng: l.lng } : null));
}

async function placesAround(p: { lat: number; lng: number }, env: Env, now: Date): Promise<{ places: Amenity[]; ok: boolean }> {
  const cell = nearbyCell(p);
  const cached = await prisma.nearbyCache.findUnique({ where: { cell } });
  if (cached && now.getTime() - cached.fetchedAt.getTime() < (cached.ok ? TTL_OK : TTL_FAIL)) return { places: cached.places as Amenity[], ok: cached.ok };
  const [clat, clng] = cell.split(",").map(Number);
  let places: Amenity[] = [], ok = false;
  try {
    const res = await timed(env.OVERPASS_URL || "https://overpass-api.de/api/interpreter", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "property-marketplace/1.0 (nearby places)" },
      body: new URLSearchParams({ data: overpassQuery({ lat: clat, lng: clng }, 2000) }).toString(),
    });
    if (res.ok) { places = parseOverpass(await res.json()); ok = true; }
  } catch { ok = false; }
  await prisma.nearbyCache.upsert({ where: { cell }, create: { cell, places, ok, fetchedAt: now }, update: { places, ok, fetchedAt: now } });
  if (!ok && cached?.ok) return { places: cached.places as Amenity[], ok: true }; // keep showing the older answer
  return { places, ok };
}

/** What is within walking distance of a published property, by kind, nearest first. */
export async function nearbyForListing(ref: string, env: Env = process.env, now = new Date()) {
  if (env.NEARBY_PLACES === "off") return { available: false as const, reason: "off" as const };
  const p = await listingPoint(ref);
  if (!p) return { available: false as const, reason: "no-position" as const };
  const r = await placesAround(p, env, now);
  if (!r.ok) return { available: false as const, reason: "unavailable" as const };
  return { available: true as const, centre: p, summary: summariseNearby(p, r.places) };
}

/** How long it takes to get from a place to a published property: real driving time when a routing server is set, otherwise an estimate. */
export async function travelToListing(ref: string, from: { lat: number; lng: number }, env: Env = process.env) {
  const p = await listingPoint(ref);
  if (!p) return null;
  const estimate = travelEstimate(from, p);
  if (env.ROUTING_URL) {
    try {
      const base = env.ROUTING_URL.replace(/\/+$/, "");
      const res = await timed(`${base}/route/v1/driving/${from.lng.toFixed(5)},${from.lat.toFixed(5)};${p.lng.toFixed(5)},${p.lat.toFixed(5)}?overview=false`);
      const route = res.ok ? parseRoute(await res.json()) : null;
      if (route) return { kind: "route" as const, km: route.km, minutes: route.minutes, estimate, to: p };
    } catch { /* fall back to the estimate */ }
  }
  return { kind: "estimate" as const, estimate, to: p };
}
