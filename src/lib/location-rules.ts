/**
 * Location intelligence rules: map layers, radius search, nearby amenities, travel-time estimates, estate boundaries and
 * directions links. Pure functions, tested on their own; the services and the map component use them.
 */
import { distanceKm, type Bounds } from "./geo-rules";

type LL = { lat: number; lng: number };

// ---------- Map layers ----------

export type TileLayer = { id: "streets" | "satellite"; label: string; url: string; attribution: string; tileSize: number; zoomOffset: number; maxZoom: number };

const OSM_ATTRIBUTION = "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors";

/**
 * The layers the map offers. Streets come from NEXT_PUBLIC_MAP_TILES (OpenStreetMap when unset). Satellite comes from
 * NEXT_PUBLIC_MAP_SATELLITE_TILES, or, when the streets provider is MapTiler, from the same MapTiler key (its "hybrid" map:
 * satellite photos with street and place names). With neither, there is no satellite layer: no free satellite source may be
 * used in production without an account, so none is assumed.
 */
export function mapLayers(env: Record<string, string | undefined>): TileLayer[] {
  const streetsUrl = env.NEXT_PUBLIC_MAP_TILES || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const layers: TileLayer[] = [{ id: "streets", label: "Streets", url: streetsUrl, attribution: env.NEXT_PUBLIC_MAP_ATTRIBUTION || OSM_ATTRIBUTION, tileSize: 256, zoomOffset: 0, maxZoom: 19 }];
  const explicit = env.NEXT_PUBLIC_MAP_SATELLITE_TILES;
  const key = /api\.maptiler\.com\/.*[?&]key=([A-Za-z0-9_-]+)/.exec(streetsUrl)?.[1];
  const maptilerCredit = "<a href=\"https://www.maptiler.com/copyright/\">&copy; MapTiler</a> " + OSM_ATTRIBUTION;
  if (explicit && /^https:\/\/.+\{z\}.+\{x\}.+\{y\}/.test(explicit)) {
    const size = Number(env.NEXT_PUBLIC_MAP_SATELLITE_TILE_SIZE) === 512 ? 512 : 256;
    layers.push({ id: "satellite", label: "Satellite", url: explicit, attribution: env.NEXT_PUBLIC_MAP_SATELLITE_ATTRIBUTION || maptilerCredit, tileSize: size, zoomOffset: size === 512 ? -1 : 0, maxZoom: 19 });
  } else if (key) {
    layers.push({ id: "satellite", label: "Satellite", url: `https://api.maptiler.com/maps/hybrid/{z}/{x}/{y}.jpg?key=${key}`, attribution: maptilerCredit, tileSize: 512, zoomOffset: -1, maxZoom: 19 });
  }
  return layers;
}

// ---------- Radius search ----------

export const RADII_KM = [1, 2, 5, 10, 20, 50] as const;

export function parseNear(raw: string | null, kmRaw: string | null): { centre: LL; km: number } | null {
  const [lat, lng] = (raw ?? "").split(",").map(Number);
  const km = Number(kmRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) return null;
  if (!(RADII_KM as readonly number[]).includes(km)) return null;
  return { centre: { lat, lng }, km };
}

/** The smallest box around a circle, for the database to narrow by before the exact distance check. */
export function circleBounds(c: LL, km: number): Bounds {
  const dLat = km / 110.574;
  const dLng = km / (111.32 * Math.max(0.01, Math.cos((c.lat * Math.PI) / 180)));
  return { s: Math.max(-85, c.lat - dLat), n: Math.min(85, c.lat + dLat), w: Math.max(-180, c.lng - dLng), e: Math.min(180, c.lng + dLng) };
}

/** Distance for a card: "850 m", "3.4 km", "27 km". */
export function distanceLabel(km: number): string {
  if (km < 1) return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`;
  return km < 10 ? `${Math.round(km * 10) / 10} km` : `${Math.round(km)} km`;
}

// ---------- Nearby places and landmarks ----------

export type AmenityKind = "landmark" | "school" | "health" | "pharmacy" | "shopping" | "bank" | "fuel" | "transport" | "food" | "worship" | "park" | "police" | "hotel";

/**
 * Each kind, with the OpenStreetMap tags that count as it (key and values) and how far to look. Everyday places are
 * counted within walking distance; landmarks (the places people give directions by) within a short drive.
 */
export const AMENITY_KINDS: { kind: AmenityKind; label: string; km: number; named?: true; tags: [string, string[]][] }[] = [
  { kind: "landmark", label: "Landmarks", km: 5, named: true, tags: [
    ["tourism", ["attraction", "museum", "gallery", "viewpoint", "zoo", "theme_park"]],
    ["historic", ["monument", "memorial", "castle", "archaeological_site", "ruins"]],
    ["leisure", ["stadium", "golf_course", "marina", "water_park", "nature_reserve"]],
    ["amenity", ["townhall", "courthouse", "events_venue", "conference_centre", "theatre", "cinema", "arts_centre", "university"]],
    ["shop", ["mall"]],
    ["aeroway", ["aerodrome"]],
  ] },
  { kind: "school", label: "Schools", km: 2, tags: [["amenity", ["school", "kindergarten", "college", "university"]]] },
  { kind: "health", label: "Hospitals and clinics", km: 2, tags: [["amenity", ["hospital", "clinic", "doctors", "dentist"]], ["healthcare", ["hospital", "clinic", "centre"]]] },
  { kind: "pharmacy", label: "Pharmacies", km: 2, tags: [["amenity", ["pharmacy"]], ["shop", ["chemist"]]] },
  { kind: "shopping", label: "Supermarkets and markets", km: 2, tags: [["shop", ["supermarket", "mall", "convenience", "department_store", "wholesale"]], ["amenity", ["marketplace"]]] },
  { kind: "bank", label: "Banks and cash points", km: 2, tags: [["amenity", ["bank", "atm", "bureau_de_change"]]] },
  { kind: "fuel", label: "Filling stations", km: 2, tags: [["amenity", ["fuel"]]] },
  { kind: "transport", label: "Bus stops and stations", km: 2, tags: [["highway", ["bus_stop"]], ["amenity", ["bus_station", "ferry_terminal", "taxi"]], ["railway", ["station", "halt"]], ["public_transport", ["station"]]] },
  { kind: "food", label: "Restaurants and cafés", km: 2, tags: [["amenity", ["restaurant", "cafe", "fast_food", "food_court"]]] },
  { kind: "worship", label: "Places of worship", km: 2, tags: [["amenity", ["place_of_worship"]]] },
  { kind: "park", label: "Parks and sports", km: 2, tags: [["leisure", ["park", "sports_centre", "pitch", "fitness_centre", "playground"]]] },
  { kind: "police", label: "Police and fire stations", km: 3, tags: [["amenity", ["police", "fire_station"]]] },
  { kind: "hotel", label: "Hotels", km: 3, tags: [["tourism", ["hotel", "guest_house", "motel"]]] },
];

/** The widest distance any kind is counted at. */
export const NEARBY_RADIUS_M = Math.max(...AMENITY_KINDS.map((k) => k.km)) * 1000;
/** The lookup is centred on the cache cell, which can be up to about 800 m from the property, so it reaches that much further. */
const CELL_SLACK_M = 800;

/** The cache cell for a position: about a kilometre square, so neighbouring properties share one lookup. */
export const nearbyCell = (p: LL) => `${(Math.round(p.lat * 100) / 100).toFixed(2)},${(Math.round(p.lng * 100) / 100).toFixed(2)}`;
/** The cache key is the cell. When the kinds looked up change, a migration clears the cache so every area is looked up again. */
export const nearbyCacheKey = (p: LL) => nearbyCell(p);

const esc = (v: string) => v.replace(/[^a-z0-9_]/gi, "");
/** A square around a point, reaching m metres each way: south, west, north, east. */
function squareAround(p: LL, m: number) {
  const dLat = m / 111_320, dLng = m / (111_320 * Math.cos((p.lat * Math.PI) / 180));
  return `${(p.lat - dLat).toFixed(5)},${(p.lng - dLng).toFixed(5)},${(p.lat + dLat).toFixed(5)},${(p.lng + dLng).toFixed(5)}`;
}
/**
 * The Overpass query: one statement per kind and tag key (values as one pattern), searching a square around the area
 * (the busy public servers answer a square far faster than a circle; distances are measured here afterwards), points and
 * outlines only, and each kind printed on its own, so a street full of bus stops cannot crowd out the schools.
 */
export function overpassQuery(p: LL, kinds: AmenityKind[] = AMENITY_KINDS.map((k) => k.kind)): string {
  const parts = AMENITY_KINDS.filter((k) => kinds.includes(k.kind)).map((k) => {
    const box = squareAround(p, Math.round(k.km * 1000 + CELL_SLACK_M));
    const sel = k.tags.map(([key, values]) => `nw["${esc(key)}"~"^(${values.map(esc).join("|")})$"]${k.named ? '["name"]' : ""}(${box});`).join("");
    return `(${sel});out tags center qt ${k.kind === "transport" || k.kind === "food" || k.kind === "shopping" ? 300 : 150};`;
  });
  return `[out:json][timeout:60];${parts.join("")}`;
}

/**
 * The lookup in three parts, asked one after another. A whole area in one question takes the busy public servers 35 to 40
 * seconds, and some connections (internet providers, the network under Ubuntu on Windows) are cut after about 30 seconds
 * of silence; each part is answered well inside that.
 */
export const NEARBY_PARTS: AmenityKind[][] = [
  ["landmark"],
  ["school", "health", "pharmacy", "bank", "fuel", "police", "hotel"],
  ["shopping", "transport", "food", "worship", "park"],
];
export const overpassQueries = (p: LL) => NEARBY_PARTS.map((kinds) => overpassQuery(p, kinds));

type Env = Record<string, string | undefined>;
const OVERPASS_SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
/** The map servers to ask, in order: OVERPASS_URL (comma separated) when set, otherwise the public ones. */
export const overpassServers = (env: Env) => (env.OVERPASS_URL ? env.OVERPASS_URL.split(",").map((x) => x.trim()).filter(Boolean) : OVERPASS_SERVERS);
/**
 * The public map servers turn away requests that do not say who is asking and how to reach them, and also names that
 * look like scrapers (words like "property listings", or posing as a browser): they answer "406 Not Acceptable". This
 * exact shape is the one the main server accepts: the site's https address (or the project page) and the purpose.
 */
export function overpassUserAgent(env: Env) {
  const site = env.NEXT_PUBLIC_APP_URL && /^https:\/\//.test(env.NEXT_PUBLIC_APP_URL) ? env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "") : "https://github.com/BOCALTD/Housy";
  return `Housy/1.0 (+${site}; nearby places)`;
}
/** The request headers for a map server: who is asking, and (the standard From header) an email to reach them on. */
export function overpassHeaders(env: Env): Record<string, string> {
  const contact = env.OVERPASS_CONTACT?.trim();
  return {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": overpassUserAgent(env),
    ...(contact && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) ? { From: contact } : {}),
  };
}

/** An Overpass answer that ran out of time or memory says so in "remark", and its elements are then incomplete. */
export function overpassFailed(json: unknown): boolean {
  const remark = (json as { remark?: unknown })?.remark;
  return typeof remark === "string" && /error|timed out|timeout|out of memory|too busy|rate limit/i.test(remark);
}

export type Amenity = { kind: AmenityKind; name: string; lat: number; lng: number };

/** A place can be more than one kind: a university is a school and a landmark, a mall is shopping and a landmark. */
const classify = (t: Record<string, string>) => AMENITY_KINDS.filter((k) => (!k.named || t.name) && k.tags.some(([key, values]) => values.includes(t[key])));

/** Read an Overpass answer: classify each element, drop anything without a position or (for landmarks) without a name. */
export function parseOverpass(json: unknown): Amenity[] {
  const els = (json as { elements?: { type?: string; id?: number; tags?: Record<string, string>; lat?: number; lon?: number; center?: { lat: number; lon: number } }[] })?.elements;
  if (!Array.isArray(els)) return [];
  const out: Amenity[] = [];
  const seen = new Set<string>();
  for (const e of els) {
    const t = e.tags ?? {};
    const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    const name = (t.name || t["name:en"] || t.brand || "").trim().slice(0, 80);
    for (const k of classify(t)) {
      // The same place is often mapped twice (a point and a building outline), and the query returns it once per kind: keep one.
      const key = `${k.kind}|${name.toLowerCase()}|${lat.toFixed(3)},${lng.toFixed(3)}`;
      const id = e.id !== undefined ? `${k.kind}|${e.type}${e.id}` : "";
      if ((name && seen.has(key)) || (id && seen.has(id))) continue;
      seen.add(key); if (id) seen.add(id);
      out.push({ kind: k.kind, name, lat, lng });
    }
  }
  return out;
}

export type NearbySummary = { kind: AmenityKind; label: string; km: number; count: number; nearest: { name: string; km: number; lat: number; lng: number }[] };

/** Per kind: how many are within its distance, and the nearest few (named ones preferred), with distances. */
export function summariseNearby(from: LL, places: Amenity[]): NearbySummary[] {
  return AMENITY_KINDS.map(({ kind, label, km: radiusKm }) => {
    const mine = places.filter((p) => p.kind === kind).map((p) => ({ ...p, km: distanceKm(from, p) })).filter((p) => p.km <= radiusKm);
    const named = mine.filter((p) => p.name).sort((a, b) => a.km - b.km);
    const unnamed = mine.filter((p) => !p.name).sort((a, b) => a.km - b.km);
    const nearest = [...named, ...unnamed].slice(0, kind === "landmark" ? 5 : 3).map((p) => ({ name: p.name || unnamedLabel(kind), km: p.km, lat: p.lat, lng: p.lng }));
    return { kind, label, km: radiusKm, count: mine.length, nearest };
  }).filter((s) => s.count > 0);
}
const unnamedLabel = (k: AmenityKind) => ({ landmark: "A landmark", school: "A school", health: "A clinic", pharmacy: "A pharmacy", shopping: "A shop", bank: "A bank or cash point", fuel: "A filling station", transport: "A bus stop", food: "A place to eat", worship: "A place of worship", park: "A park", police: "A police station", hotel: "A hotel" })[k];

// ---------- Travel time ----------

/** Road distance is longer than a straight line; this is the usual city factor. */
export const ROAD_FACTOR = 1.35;
const SPEEDS = { car: { quiet: 35, busy: 15 }, walk: { quiet: 4.5, busy: 4.5 } } as const;

/**
 * A rough travel time between two places from the straight-line distance: by car a range from quiet roads to rush hour,
 * walking only when it is under an hour. Shown as an estimate, never as a route.
 */
export function travelEstimate(a: LL, b: LL): { roadKm: number; car: { minMin: number; maxMin: number }; walkMin: number | null } {
  const roadKm = distanceKm(a, b) * ROAD_FACTOR;
  const mins = (kmh: number) => Math.max(1, Math.round((roadKm / kmh) * 60));
  const walk = mins(SPEEDS.walk.quiet);
  return { roadKm, car: { minMin: mins(SPEEDS.car.quiet), maxMin: mins(SPEEDS.car.busy) }, walkMin: walk <= 60 ? walk : null };
}

export const minutesLabel = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`);

/** Read an OSRM-compatible routing answer (ROUTING_URL), or null. */
export function parseRoute(json: unknown): { km: number; minutes: number } | null {
  const r = (json as { code?: string; routes?: { distance?: number; duration?: number }[] })?.routes?.[0];
  if ((json as { code?: string })?.code !== "Ok" || !r || typeof r.distance !== "number" || typeof r.duration !== "number") return null;
  return { km: r.distance / 1000, minutes: Math.max(1, Math.round(r.duration / 60)) };
}

// ---------- Directions ----------

/** Links that open turn-by-turn directions in the person's own maps app. No key is needed for any of them. */
export function directionsLinks(to: LL, from?: LL | null, stops: LL[] = []) {
  const f = (p: LL) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  const g = new URLSearchParams({ api: "1", destination: f(to), travelmode: "driving" });
  if (from) g.set("origin", f(from));
  if (stops.length) g.set("waypoints", stops.slice(0, 9).map(f).join("|"));
  return {
    google: `https://www.google.com/maps/dir/?${g.toString()}`,
    apple: `https://maps.apple.com/?daddr=${f(to)}${from ? `&saddr=${f(from)}` : ""}&dirflg=d`,
    waze: `https://waze.com/ul?ll=${f(to)}&navigate=yes`,
  };
}

// ---------- Estate and development boundaries ----------

export const BOUNDARY_MAX_POINTS = 60;

/** A drawn site outline: 3 to 60 corners, each a real position, all within 10 km of each other, not crossing itself. */
export function checkBoundary(raw: unknown): { ok: true; points: [number, number][] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "Draw the outline on the map" };
  const pts = raw.map((p) => (Array.isArray(p) ? [Number(p[0]), Number(p[1])] : [NaN, NaN]) as [number, number]);
  if (pts.length < 3) return { ok: false, error: "An outline needs at least 3 corners" };
  if (pts.length > BOUNDARY_MAX_POINTS) return { ok: false, error: `Use at most ${BOUNDARY_MAX_POINTS} corners` };
  if (pts.some(([la, ln]) => !Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 85 || Math.abs(ln) > 180)) return { ok: false, error: "A corner is not a real position" };
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    if (distanceKm({ lat: pts[i][0], lng: pts[i][1] }, { lat: pts[j][0], lng: pts[j][1] }) > 10) return { ok: false, error: "The outline is more than 10 km across. Draw just the site." };
  }
  if (selfIntersects(pts)) return { ok: false, error: "The outline crosses itself. Draw the corners in order around the site." };
  return { ok: true, points: pts.map(([la, ln]) => [Math.round(la * 1e6) / 1e6, Math.round(ln * 1e6) / 1e6]) };
}

function selfIntersects(p: [number, number][]): boolean {
  const n = p.length;
  const cross = (a: [number, number], b: [number, number], c: [number, number]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const hit = (a: [number, number], b: [number, number], c: [number, number], d: [number, number]) =>
    cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
    if (hit(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n])) return true;
  }
  return false;
}

/** Area of an outline in square metres (for "about 2.4 hectares"). */
export function boundaryAreaSqm(pts: [number, number][]): number {
  const lat0 = (pts.reduce((n, p) => n + p[0], 0) / pts.length) * (Math.PI / 180);
  const xy = pts.map(([la, ln]) => [ln * 111320 * Math.cos(lat0), la * 110574]);
  let s = 0;
  for (let i = 0; i < xy.length; i++) { const [x1, y1] = xy[i], [x2, y2] = xy[(i + 1) % xy.length]; s += x1 * y2 - x2 * y1; }
  return Math.abs(s) / 2;
}

export const areaLabel = (sqm: number) => (sqm >= 10_000 ? `about ${Math.round(sqm / 1000) / 10} hectares` : `about ${Math.round(sqm / 10) * 10} m²`);
