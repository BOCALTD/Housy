/**
 * Nearby places, landmarks and travel times for a property, from public map data.
 * - Nearby: OpenStreetMap data through an Overpass server. OVERPASS_URL may list several, separated by commas; by default
 *   the main public server is tried first and two other public servers after it, so one busy server does not leave the
 *   section empty. One lookup covers a square kilometre and is kept for 30 days in nearby_cache (an empty answer for a day,
 *   in case the map was still loading); a failed lookup is retried after five minutes. Set NEARBY_PLACES=off to switch it off.
 * - Travel time: an estimate from the distance, or real driving times when ROUTING_URL points at an OSRM-compatible server.
 * Only the property's public position (blurred to about a kilometre) is ever sent out, never an address or a person's data.
 */
import { prisma, withPublic } from "../db";
import { nearbyCacheKey, nearbyCell, overpassFailed, overpassQuery, overpassHeaders, overpassServers, parseOverpass, parseRoute, summariseNearby, travelEstimate, type Amenity } from "../location-rules";

const DAY = 864e5;
const TTL_OK = 30 * DAY, TTL_EMPTY = DAY, TTL_FAIL = 5 * 60_000;
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

const ttl = (c: { ok: boolean; places: unknown }) => (!c.ok ? TTL_FAIL : Array.isArray(c.places) && c.places.length ? TTL_OK : TTL_EMPTY);

/**
 * Ask each server in turn until one gives a complete answer. A server that is busy, slow or cut its answer short is skipped.
 * The whole lookup takes at most BUDGET_MS, because a visitor is waiting for the page section; reading the answer counts too.
 */
const BUDGET_MS = 25_000, PER_SERVER_MS = 15_000;
async function askOverpass(query: string, env: Env): Promise<Amenity[] | null> {
  const servers = overpassServers(env);
  const deadline = Date.now() + BUDGET_MS;
  for (const [i, url] of servers.entries()) {
    const left = deadline - Date.now();
    if (left < 2_000) break; // give up for now; the next visit tries again after a few minutes
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), i === servers.length - 1 ? left : Math.min(PER_SERVER_MS, left));
    try {
      const res = await fetcher(url, {
        method: "POST", signal: ctrl.signal, cache: "no-store",
        headers: overpassHeaders(env),
        body: new URLSearchParams({ data: query }).toString(),
      });
      if (!res.ok) continue;
      const json: unknown = await res.json();
      if (overpassFailed(json) || !Array.isArray((json as { elements?: unknown }).elements)) continue;
      return parseOverpass(json);
    } catch { /* try the next server */ } finally { clearTimeout(timer); }
  }
  return null;
}

async function placesAround(p: { lat: number; lng: number }, env: Env, now: Date): Promise<{ places: Amenity[]; ok: boolean }> {
  const cell = nearbyCacheKey(p);
  const cached = await prisma.nearbyCache.findUnique({ where: { cell } });
  if (cached && now.getTime() - cached.fetchedAt.getTime() < ttl(cached)) return { places: cached.places as Amenity[], ok: cached.ok };
  // Only the cell centre (the blurred public position) is sent, never the property's own position.
  const [clat, clng] = nearbyCell(p).split(",").map(Number);
  const found = await askOverpass(overpassQuery({ lat: clat, lng: clng }), env);
  if (!found && cached?.ok) {
    // Keep showing the older answer, and try again in a few minutes rather than on every visit.
    await prisma.nearbyCache.update({ where: { cell }, data: { fetchedAt: new Date(now.getTime() - ttl(cached) + TTL_FAIL) } });
    return { places: cached.places as Amenity[], ok: true };
  }
  const places = found ?? [], ok = !!found;
  await prisma.nearbyCache.upsert({ where: { cell }, create: { cell, places, ok, fetchedAt: now }, update: { places, ok, fetchedAt: now } });
  return { places, ok };
}

/** What is near a published property (everyday places within walking distance, landmarks within a short drive), by kind, nearest first. */
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
