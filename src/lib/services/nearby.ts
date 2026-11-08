/**
 * Nearby places, landmarks and travel times for a property, from public map data.
 * - Nearby: OpenStreetMap data through an Overpass server. OVERPASS_URL may list several, separated by commas; by default
 *   the main public server is tried first and two other public servers after it. The free servers are often busy and take
 *   half a minute or more to answer, so nobody waits for them: the first visit to an area starts the lookup in the
 *   background and the page fills in when it lands; publishing a property starts it too. One lookup covers a square
 *   kilometre and is kept for 30 days in nearby_cache (an empty answer for a day); a failed lookup is retried after five
 *   minutes, and an older answer keeps showing meanwhile. Set NEARBY_PLACES=off to switch it off.
 * - Travel time: an estimate from the distance, or real driving times when ROUTING_URL points at an OSRM-compatible server.
 * Only the property's public position (blurred to about a kilometre) is ever sent out, never an address or a person's data.
 */
import { prisma, withPublic } from "../db";
import { nearbyCacheKey, nearbyCell, overpassFailed, overpassQueries, overpassHeaders, overpassServers, parseOverpass, parseRoute, summariseNearby, travelEstimate, type Amenity } from "../location-rules";

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
 * This runs in the background, so it can wait as long as the free servers need (they often take 30 to 40 seconds).
 */
const BUDGET_MS = 240_000, PER_SERVER_MS = 75_000;
let BUSY_WAIT_MS = 15_000;
/** Tests shorten the wait before asking a busy server again. */
export function setBusyWaitForTests(ms: number) { BUSY_WAIT_MS = ms; }
/** What happened with each server, for the command-line tools (never shown to visitors). */
export type Attempt = { server: string; ms: number; result: string };
let onAttempt: ((a: Attempt) => void) | null = null;
export function reportNearbyAttempts(f: ((a: Attempt) => void) | null) { onAttempt = f; }

/** Why the last lookup failed: "offline" when no server could even be reached (this machine has no connection). */
let lastFailure: "offline" | "busy" | null = null;

async function askOverpass(query: string, env: Env): Promise<unknown[] | null> {
  const servers = overpassServers(env);
  const deadline = Date.now() + BUDGET_MS;
  let reached = false;
  lastFailure = null;
  for (const url of servers) {
    // A server that says it is full right now (502/504/429) usually has room again within half a minute: wait and ask it
    // again a few times before moving on, since the other public servers are often slower still from Nigeria.
    for (let attempt = 0; attempt < 4; attempt++) {
      const left = deadline - Date.now();
      if (left < 5_000) { lastFailure = reached ? "busy" : "offline"; return null; }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), Math.min(PER_SERVER_MS, left));
      const t = Date.now();
      const note = (result: string) => onAttempt?.({ server: new URL(url).host, ms: Date.now() - t, result });
      let busy = false;
      try {
        const res = await fetcher(url, { method: "POST", signal: ctrl.signal, cache: "no-store", headers: overpassHeaders(env), body: new URLSearchParams({ data: query }).toString() });
        reached = true;
        if (!res.ok) {
          busy = res.status === 502 || res.status === 504 || res.status === 429;
          note(res.status === 406 ? "refused (406)" : res.status === 429 ? "too many requests from this machine (429)" : busy ? `busy, at capacity (${res.status})` : `error ${res.status}`);
        } else {
          const json: unknown = await res.json();
          if (overpassFailed(json) || !Array.isArray((json as { elements?: unknown }).elements)) {
            busy = true;
            note(`ran out of time: ${String((json as { remark?: unknown }).remark ?? "").slice(0, 80)}`);
          } else {
            note("answered");
            return (json as { elements: unknown[] }).elements;
          }
        }
      } catch (e) {
        const c = (e as { cause?: { code?: string } }).cause;
        if ((e as Error).name === "AbortError") reached = true; // connected, but the answer was too slow
        note((e as Error).name === "AbortError" ? "no answer in time" : `could not connect${c?.code ? ` [${c.code}]` : ""}`);
      } finally { clearTimeout(timer); }
      if (!busy) break;
      const pause = Math.min(BUSY_WAIT_MS * (attempt + 1), deadline - Date.now() - 5_000);
      if (pause <= 0) { lastFailure = "busy"; return null; }
      onAttempt?.({ server: new URL(url).host, ms: pause, result: "waiting to ask again" });
      await new Promise((r) => setTimeout(r, pause));
    }
  }
  lastFailure = reached ? "busy" : "offline";
  return null;
}

/** Lookups in progress, one per area, so many visitors to the same area start one lookup between them. */
const inflight = new Map<string, Promise<void>>();

/** Look an area up and store the answer. Only the cell centre (the blurred public position) is sent, never the property's own. */
function refresh(p: { lat: number; lng: number }, env: Env): Promise<void> {
  const cell = nearbyCacheKey(p);
  const running = inflight.get(cell);
  if (running) return running;
  const job = (async () => {
    const [clat, clng] = nearbyCell(p).split(",").map(Number);
    // Each part on its own; every part must arrive, or the area is tried again later (half an answer would read as
    // "no schools here" when they were simply not fetched).
    let raw: unknown[] | null = [];
    for (const q of overpassQueries({ lat: clat, lng: clng })) {
      const part = await askOverpass(q, env);
      if (!part) { raw = null; break; }
      raw.push(...part);
    }
    // Read once over all parts, so a place returned by two parts (a mall is shopping and a landmark) is not counted twice.
    const found = raw ? parseOverpass({ elements: raw }) : null;
    const now = new Date();
    const cached = await prisma.nearbyCache.findUnique({ where: { cell } });
    if (!found && cached?.ok) {
      // Keep the older answer, and try again in a few minutes.
      await prisma.nearbyCache.update({ where: { cell }, data: { fetchedAt: new Date(now.getTime() - ttl(cached) + TTL_FAIL) } });
      return;
    }
    const places = found ?? [], ok = !!found;
    await prisma.nearbyCache.upsert({ where: { cell }, create: { cell, places, ok, fetchedAt: now }, update: { places, ok, fetchedAt: now } });
  })().catch(() => { /* the next visit tries again */ }).finally(() => inflight.delete(cell));
  inflight.set(cell, job);
  return job;
}

/** Wait for every lookup in progress (the API route keeps the server working on them after it has answered). */
export const nearbyLookupsSettled = () => Promise.allSettled([...inflight.values()]).then(() => undefined);

/**
 * Look up every published property's area that is not known yet, one area at a time (the free servers allow two requests
 * at once per machine, and a polite gap between them). For a schedule or by hand: npm run nearby:warm.
 */
export async function warmAllNearby(env: Env = process.env, opts: { limit?: number; retry?: boolean; onEach?: (cell: string, ok: boolean, left: number, why: "offline" | "busy" | null) => void; onRetry?: (n: number) => void } = {}) {
  if (env.NEARBY_PLACES === "off") return { looked: 0, ok: 0, offline: false as const };
  const rows = await withPublic((tx) => tx.listing.findMany({ where: { status: "PUBLISHED", lat: { not: null }, lng: { not: null } }, select: { lat: true, lng: true } }));
  const cells = new Map<string, { lat: number; lng: number }>();
  for (const r of rows) if (r.lat !== null && r.lng !== null) cells.set(nearbyCacheKey({ lat: r.lat, lng: r.lng }), { lat: r.lat, lng: r.lng });
  const known = await prisma.nearbyCache.findMany({ where: { cell: { in: [...cells.keys()] } } });
  const now = Date.now();
  // Only a fresh answer counts as known; an area that failed a moment ago is exactly what this run is for.
  for (const c of known) if (c.ok && now - c.fetchedAt.getTime() < ttl(c)) cells.delete(c.cell);
  const todo = [...cells].slice(0, opts.limit ?? 200);
  let ok = 0;
  const missed: [string, { lat: number; lng: number }][] = [];
  let offlineRun = 0, offline = false;
  const one = async (cell: string, p: { lat: number; lng: number }, left: number) => {
    await prisma.nearbyCache.deleteMany({ where: { cell, ok: false } }); // a failure a moment ago must not stop this try
    await refresh(p, env);
    const got = await prisma.nearbyCache.findUnique({ where: { cell } });
    opts.onEach?.(cell, !!got?.ok, left, got?.ok ? null : lastFailure);
    offlineRun = got?.ok ? 0 : lastFailure === "offline" ? offlineRun + 1 : 0;
    return !!got?.ok;
  };
  for (const [i, [cell, p]] of todo.entries()) {
    if (await one(cell, p, todo.length - i - 1)) ok += 1; else missed.push([cell, p]);
    // Two areas in a row where no server could even be reached: this machine is offline (or just woke from sleep). Stop
    // instead of marking every area as missed; nothing found so far is lost.
    if (offlineRun >= 2) { offline = true; break; }
    if (i < todo.length - 1) await new Promise((r) => setTimeout(r, 5_000));
  }
  if (offline) return { looked: todo.length, ok, offline: true as const };
  // The servers are often full for a while: one more go at the areas that missed, after a pause.
  if (missed.length && opts.retry !== false) {
    opts.onRetry?.(missed.length);
    await new Promise((r) => setTimeout(r, 30_000));
    for (const [i, [cell, p]] of missed.entries()) {
      if (await one(cell, p, missed.length - i - 1)) ok += 1;
      if (i < missed.length - 1) await new Promise((r) => setTimeout(r, 5_000));
    }
  }
  return { looked: todo.length, ok, offline: false as const };
}

type Places = { state: "ready"; places: Amenity[] } | { state: "failed" } | { state: "pending" };
async function placesAround(p: { lat: number; lng: number }, env: Env, now: Date, waitMs: number): Promise<Places> {
  const cell = nearbyCacheKey(p);
  const read = () => prisma.nearbyCache.findUnique({ where: { cell } });
  let cached = await read();
  const fresh = (c: NonNullable<typeof cached>) => now.getTime() - c.fetchedAt.getTime() < ttl(c);
  if (cached && fresh(cached)) return cached.ok ? { state: "ready", places: cached.places as Amenity[] } : { state: "failed" };
  const job = refresh(p, env);
  // Wait a little: a fast server (or one already working on this area) often answers in time for this visit.
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([job, new Promise<void>((r) => { timer = setTimeout(r, waitMs); })]);
  clearTimeout(timer);
  cached = await read();
  if (cached && cached.fetchedAt.getTime() >= now.getTime() - 1000 && !inflight.has(cell)) return cached.ok ? { state: "ready", places: cached.places as Amenity[] } : { state: "failed" };
  // Still looking: an older answer shows meanwhile; otherwise the page says it is looking and asks again shortly.
  if (cached?.ok) return { state: "ready", places: cached.places as Amenity[] };
  return { state: "pending" };
}

/**
 * What is near a published property (everyday places within walking distance, landmarks within a short drive), by kind,
 * nearest first. waitMs is how long this visit waits for a lookup that is not known yet; after that it answers "pending"
 * and the lookup carries on in the background. Left out, it waits for the lookup to finish.
 */
export async function nearbyForListing(ref: string, env: Env = process.env, now = new Date(), opts: { waitMs?: number } = {}) {
  if (env.NEARBY_PLACES === "off") return { available: false as const, reason: "off" as const };
  const p = await listingPoint(ref);
  if (!p) return { available: false as const, reason: "no-position" as const };
  const r = await placesAround(p, env, now, opts.waitMs ?? BUDGET_MS + 5_000);
  if (r.state === "pending") return { available: false as const, reason: "pending" as const };
  if (r.state === "failed") return { available: false as const, reason: "unavailable" as const };
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
