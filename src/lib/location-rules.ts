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

// ---------- Nearby amenities ----------

export type AmenityKind = "school" | "health" | "pharmacy" | "shopping" | "bank" | "fuel" | "transport" | "food" | "worship" | "park" | "police";

/** Each kind, with the OpenStreetMap tags that count as it. */
export const AMENITY_KINDS: { kind: AmenityKind; label: string; tags: [string, string][] }[] = [
  { kind: "school", label: "Schools", tags: [["amenity", "school"], ["amenity", "kindergarten"], ["amenity", "college"], ["amenity", "university"]] },
  { kind: "health", label: "Hospitals and clinics", tags: [["amenity", "hospital"], ["amenity", "clinic"], ["amenity", "doctors"]] },
  { kind: "pharmacy", label: "Pharmacies", tags: [["amenity", "pharmacy"]] },
  { kind: "shopping", label: "Supermarkets and markets", tags: [["shop", "supermarket"], ["amenity", "marketplace"], ["shop", "mall"]] },
  { kind: "bank", label: "Banks and cash points", tags: [["amenity", "bank"], ["amenity", "atm"]] },
  { kind: "fuel", label: "Filling stations", tags: [["amenity", "fuel"]] },
  { kind: "transport", label: "Bus stops and stations", tags: [["highway", "bus_stop"], ["amenity", "bus_station"], ["railway", "station"]] },
  { kind: "food", label: "Restaurants and cafés", tags: [["amenity", "restaurant"], ["amenity", "cafe"], ["amenity", "fast_food"]] },
  { kind: "worship", label: "Places of worship", tags: [["amenity", "place_of_worship"]] },
  { kind: "park", label: "Parks and sports", tags: [["leisure", "park"], ["leisure", "sports_centre"], ["leisure", "pitch"]] },
  { kind: "police", label: "Police stations", tags: [["amenity", "police"]] },
];

export const NEARBY_RADIUS_M = 1500;

/** The cache cell for a position: about a kilometre square, so neighbouring properties share one lookup. */
export const nearbyCell = (p: LL) => `${(Math.round(p.lat * 100) / 100).toFixed(2)},${(Math.round(p.lng * 100) / 100).toFixed(2)}`;

/** The Overpass query for every kind around a point, nodes and the centres of ways, at most 400 results. */
export function overpassQuery(p: LL, radiusM = NEARBY_RADIUS_M): string {
  const sel = AMENITY_KINDS.flatMap((k) => k.tags).map(([key, value]) => `nwr["${key}"="${value}"](around:${radiusM},${p.lat.toFixed(5)},${p.lng.toFixed(5)});`).join("");
  return `[out:json][timeout:20];(${sel});out center 400;`;
}

export type Amenity = { kind: AmenityKind; name: string; lat: number; lng: number };

/** Read an Overpass answer: classify each element, keep named ones first, drop anything without a position. */
export function parseOverpass(json: unknown): Amenity[] {
  const els = (json as { elements?: { tags?: Record<string, string>; lat?: number; lon?: number; center?: { lat: number; lon: number } }[] })?.elements;
  if (!Array.isArray(els)) return [];
  const out: Amenity[] = [];
  for (const e of els) {
    const t = e.tags ?? {};
    const k = AMENITY_KINDS.find((x) => x.tags.some(([key, value]) => t[key] === value));
    const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
    if (!k || typeof lat !== "number" || typeof lng !== "number") continue;
    const name = (t.name || t["name:en"] || "").trim().slice(0, 80);
    out.push({ kind: k.kind, name, lat, lng });
  }
  return out;
}

export type NearbySummary = { kind: AmenityKind; label: string; count: number; nearest: { name: string; km: number; lat: number; lng: number }[] };

/** Per kind: how many are within the radius, and the nearest three (named ones preferred), with distances. */
export function summariseNearby(from: LL, places: Amenity[], radiusKm = NEARBY_RADIUS_M / 1000): NearbySummary[] {
  return AMENITY_KINDS.map(({ kind, label }) => {
    const mine = places.filter((p) => p.kind === kind).map((p) => ({ ...p, km: distanceKm(from, p) })).filter((p) => p.km <= radiusKm);
    const named = mine.filter((p) => p.name).sort((a, b) => a.km - b.km);
    const unnamed = mine.filter((p) => !p.name).sort((a, b) => a.km - b.km);
    const nearest = [...named, ...unnamed].slice(0, 3).map((p) => ({ name: p.name || unnamedLabel(kind), km: p.km, lat: p.lat, lng: p.lng }));
    return { kind, label, count: mine.length, nearest };
  }).filter((s) => s.count > 0);
}
const unnamedLabel = (k: AmenityKind) => ({ school: "A school", health: "A clinic", pharmacy: "A pharmacy", shopping: "A shop", bank: "A bank or cash point", fuel: "A filling station", transport: "A bus stop", food: "A place to eat", worship: "A place of worship", park: "A park", police: "A police station" })[k];

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
