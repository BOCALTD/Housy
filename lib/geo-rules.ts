/**
 * Places in Nigeria, positions and privacy.
 *
 * The built-in list gives an approximate centre for common cities, districts and state capitals, so properties can be placed on a
 * map without asking anyone for coordinates. These are area centres, never street addresses. A property that has a position
 * set by its owner uses that; the public always sees a position rounded to about one kilometre.
 */

export interface Place { name: string; state: string; lat: number; lng: number; kind: "AREA" | "CITY" | "STATE" }

const P = (name: string, state: string, lat: number, lng: number, kind: Place["kind"] = "CITY"): Place => ({ name, state, lat, lng, kind });

export const STATES: Place[] = [
  P("Abia", "Abia", 5.525, 7.4903, "STATE"), P("Adamawa", "Adamawa", 9.2035, 12.4954, "STATE"), P("Akwa Ibom", "Akwa Ibom", 5.0377, 7.9128, "STATE"),
  P("Anambra", "Anambra", 6.2104, 7.0741, "STATE"), P("Bauchi", "Bauchi", 10.3158, 9.8442, "STATE"), P("Bayelsa", "Bayelsa", 4.9267, 6.2676, "STATE"),
  P("Benue", "Benue", 7.7337, 8.5214, "STATE"), P("Borno", "Borno", 11.8333, 13.15, "STATE"), P("Cross River", "Cross River", 4.9589, 8.3269, "STATE"),
  P("Delta", "Delta", 6.1985, 6.7338, "STATE"), P("Ebonyi", "Ebonyi", 6.3249, 8.1137, "STATE"), P("Edo", "Edo", 6.335, 5.6037, "STATE"),
  P("Ekiti", "Ekiti", 7.6211, 5.2214, "STATE"), P("Enugu", "Enugu", 6.4584, 7.5464, "STATE"), P("Gombe", "Gombe", 10.2897, 11.1673, "STATE"),
  P("Imo", "Imo", 5.4836, 7.0333, "STATE"), P("Jigawa", "Jigawa", 11.7561, 9.3389, "STATE"), P("Kaduna", "Kaduna", 10.5105, 7.4165, "STATE"),
  P("Kano", "Kano", 12.0022, 8.592, "STATE"), P("Katsina", "Katsina", 12.9908, 7.6018, "STATE"), P("Kebbi", "Kebbi", 12.4539, 4.1975, "STATE"),
  P("Kogi", "Kogi", 7.8023, 6.7333, "STATE"), P("Kwara", "Kwara", 8.4966, 4.5421, "STATE"), P("Lagos", "Lagos", 6.5244, 3.3792, "STATE"),
  P("Nasarawa", "Nasarawa", 8.4939, 8.5153, "STATE"), P("Niger", "Niger", 9.6139, 6.5569, "STATE"), P("Ogun", "Ogun", 7.1475, 3.3619, "STATE"),
  P("Ondo", "Ondo", 7.2571, 5.2058, "STATE"), P("Osun", "Osun", 7.7827, 4.5418, "STATE"), P("Oyo", "Oyo", 7.3775, 3.947, "STATE"),
  P("Plateau", "Plateau", 9.8965, 8.8583, "STATE"), P("Rivers", "Rivers", 4.8156, 7.0498, "STATE"), P("Sokoto", "Sokoto", 13.0059, 5.2476, "STATE"),
  P("Taraba", "Taraba", 8.8833, 11.3667, "STATE"), P("Yobe", "Yobe", 11.7469, 11.9608, "STATE"), P("Zamfara", "Zamfara", 12.17, 6.66, "STATE"),
  P("Federal Capital Territory", "FCT", 9.0765, 7.3986, "STATE"),
];

export const PLACES: Place[] = [
  // Lagos
  P("Lekki", "Lagos", 6.4698, 3.5852, "AREA"), P("Ikoyi", "Lagos", 6.4549, 3.4246, "AREA"), P("Victoria Island", "Lagos", 6.4281, 3.4219, "AREA"),
  P("Ikeja", "Lagos", 6.6018, 3.3515, "AREA"), P("Surulere", "Lagos", 6.5, 3.35, "AREA"), P("Yaba", "Lagos", 6.5095, 3.3711, "AREA"),
  P("Ajah", "Lagos", 6.4667, 3.5667, "AREA"), P("Magodo", "Lagos", 6.6294, 3.3842, "AREA"), P("Maryland", "Lagos", 6.5667, 3.3667, "AREA"),
  P("Ikorodu", "Lagos", 6.6194, 3.5105, "AREA"), P("Epe", "Lagos", 6.5841, 3.9833, "AREA"), P("Badagry", "Lagos", 6.4155, 2.8811, "AREA"),
  P("Festac", "Lagos", 6.4667, 3.2833, "AREA"), P("Apapa", "Lagos", 6.4474, 3.3594, "AREA"),
  // FCT
  P("Maitama", "FCT", 9.0833, 7.5, "AREA"), P("Asokoro", "FCT", 9.0333, 7.5333, "AREA"), P("Wuse", "FCT", 9.0667, 7.4833, "AREA"),
  P("Gwarinpa", "FCT", 9.11, 7.4, "AREA"), P("Garki", "FCT", 9.03, 7.49, "AREA"), P("Jabi", "FCT", 9.0646, 7.4244, "AREA"),
  P("Katampe", "FCT", 9.1, 7.47, "AREA"), P("Lugbe", "FCT", 8.9856, 7.3792, "AREA"), P("Kubwa", "FCT", 9.1558, 7.3239, "AREA"),
  // Cities
  P("Lagos", "Lagos", 6.5244, 3.3792), P("Abuja", "FCT", 9.0765, 7.3986), P("Port Harcourt", "Rivers", 4.8156, 7.0498), P("Ibadan", "Oyo", 7.3775, 3.947),
  P("Kano", "Kano", 12.0022, 8.592), P("Kaduna", "Kaduna", 10.5105, 7.4165), P("Enugu", "Enugu", 6.4584, 7.5464), P("Benin City", "Edo", 6.335, 5.6037),
  P("Abeokuta", "Ogun", 7.1475, 3.3619), P("Owerri", "Imo", 5.4836, 7.0333), P("Calabar", "Cross River", 4.9589, 8.3269), P("Uyo", "Akwa Ibom", 5.0377, 7.9128),
  P("Jos", "Plateau", 9.8965, 8.8583), P("Ilorin", "Kwara", 8.4966, 4.5421), P("Akure", "Ondo", 7.2571, 5.2058), P("Asaba", "Delta", 6.1985, 6.7338),
  P("Warri", "Delta", 5.5167, 5.75), P("Abakaliki", "Ebonyi", 6.3249, 8.1137), P("Awka", "Anambra", 6.2104, 7.0741), P("Onitsha", "Anambra", 6.1498, 6.7857),
  P("Maiduguri", "Borno", 11.8333, 13.15), P("Sokoto", "Sokoto", 13.0059, 5.2476), P("Yola", "Adamawa", 9.2035, 12.4954), P("Makurdi", "Benue", 7.7337, 8.5214),
  P("Lokoja", "Kogi", 7.8023, 6.7333), P("Minna", "Niger", 9.6139, 6.5569), P("Osogbo", "Osun", 7.7827, 4.5418), P("Ado Ekiti", "Ekiti", 7.6211, 5.2214),
  P("Bauchi", "Bauchi", 10.3158, 9.8442), P("Gombe", "Gombe", 10.2897, 11.1673), P("Jalingo", "Taraba", 8.8833, 11.3667), P("Lafia", "Nasarawa", 8.4939, 8.5153),
  P("Dutse", "Jigawa", 11.7561, 9.3389), P("Katsina", "Katsina", 12.9908, 7.6018), P("Birnin Kebbi", "Kebbi", 12.4539, 4.1975), P("Damaturu", "Yobe", 11.7469, 11.9608),
  P("Umuahia", "Abia", 5.525, 7.4903), P("Aba", "Abia", 5.1066, 7.3667), P("Yenagoa", "Bayelsa", 4.9267, 6.2676), P("Gusau", "Zamfara", 12.17, 6.66),
  P("Ikot Ekpene", "Akwa Ibom", 5.18, 7.71), P("Sapele", "Delta", 5.8904, 5.6766), P("Ogbomosho", "Oyo", 8.1337, 4.2401), P("Ijebu Ode", "Ogun", 6.8183, 3.9183),
];

export const NIGERIA = { latMin: 3.5, latMax: 14.5, lngMin: 2.5, lngMax: 15.0 } as const;
export const CENTRE = { lat: 9.08, lng: 8.68 } as const;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const ALIASES: Record<string, string> = { vi: "victoria island", ph: "port harcourt", "port-harcourt": "port harcourt", fct: "federal capital territory", benin: "benin city", "abuja fct": "abuja" };

const INDEX = new Map<string, Place>();
for (const p of [...STATES, ...PLACES]) { const k = norm(p.name); if (!INDEX.has(k) || p.kind === "AREA") INDEX.set(k, p); }

/** A named place the text is about, or undefined. Longest names win, so "Victoria Island" is not read as "Island". */
export function findPlace(text: string): Place | undefined {
  const t = ` ${norm(text)} `;
  let best: Place | undefined; let bestLen = 0;
  for (const [k, p] of INDEX) { if (k.length > bestLen && t.includes(` ${k} `)) { best = p; bestLen = k.length; } }
  for (const [a, full] of Object.entries(ALIASES)) { const p = INDEX.get(full); if (p && a.length > bestLen && t.includes(` ${a} `)) { best = p; bestLen = a.length; } }
  return best;
}

export type Position = { lat: number; lng: number; approximate: boolean };

/** A real position anywhere in the world (the marketplace is not limited to Nigeria). 0,0 is treated as "not set". */
export function validPosition(lat: unknown, lng: unknown): lat is number {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && lat >= -85 && lat <= 85 && lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0);
}

/** Map bounds as south, west, north, east. */
export type Bounds = { s: number; w: number; n: number; e: number };

export function parseBounds(raw: string | null): Bounds | null {
  const parts = (raw ?? "").split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [s, w, n, e] = parts;
  const b = { s: Math.max(-85, s), w: Math.max(-180, w), n: Math.min(85, n), e: Math.min(180, e) };
  return b.s < b.n && b.w < b.e ? b : null;
}

export function inBounds(p: { lat: number; lng: number }, b: Bounds): boolean {
  return p.lat >= b.s && p.lat <= b.n && p.lng >= b.w && p.lng <= b.e;
}

/** Grid size for grouping markers at a web-map zoom level: about four groups across one map tile. */
export function clusterCell(zoom: number): number {
  return 360 / 2 ** Math.max(0, Math.min(20, Math.round(zoom))) / 4;
}

/** Short price for a map pin: 2500000 naira → "2.5m". */
export function shortMoney(kobo: bigint): string {
  const n = Number(kobo / 100n);
  const f = (v: number, unit: string) => `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10}${unit}`;
  if (n >= 1e9) return f(n / 1e9, "bn");
  if (n >= 1e6) return f(n / 1e6, "m");
  if (n >= 1e3) return f(n / 1e3, "k");
  return String(n);
}

/** Where to draw something: its own position when it has one, otherwise the centre of the area it names. */
export function locate(o: { lat?: number | null; lng?: number | null; area?: string | null; city?: string | null; state?: string | null }): Position | null {
  if (validPosition(o.lat, o.lng)) return { lat: o.lat as number, lng: o.lng as number, approximate: false };
  const bySpecific = [o.area, o.city].filter(Boolean).map((x) => findPlace(String(x))).find(Boolean);
  const hit = bySpecific ?? (o.state ? findPlace(String(o.state)) : undefined);
  return hit ? { lat: hit.lat, lng: hit.lng, approximate: true } : null;
}

/** What the public may see: a position blurred to about one kilometre. The same input always gives the same output. */
export function publicPosition(lat: number, lng: number): { lat: number; lng: number } {
  return { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 };
}

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface MapPoint { id: string; lat: number; lng: number; label: string; href?: string; weight?: number; approximate?: boolean; group?: string }
export interface Cluster { lat: number; lng: number; count: number; weight: number; points: MapPoint[]; approximate: boolean }

/** Group points that fall in the same square cell. Smaller cells show more detail. The centre of a cluster is the average of its points. */
export function cluster(points: MapPoint[], cellDegrees: number): Cluster[] {
  const cell = Math.max(0.005, cellDegrees);
  const m = new Map<string, MapPoint[]>();
  for (const p of points) {
    const k = `${Math.floor(p.lat / cell)}:${Math.floor(p.lng / cell)}`;
    const a = m.get(k); if (a) a.push(p); else m.set(k, [p]);
  }
  return [...m.values()].map((ps) => ({
    lat: ps.reduce((n, p) => n + p.lat, 0) / ps.length,
    lng: ps.reduce((n, p) => n + p.lng, 0) / ps.length,
    count: ps.length, weight: ps.reduce((n, p) => n + (p.weight ?? 1), 0), points: ps, approximate: ps.some((p) => p.approximate),
  })).sort((a, b) => b.count - a.count);
}

/** Cell size for a zoom level: 1 shows all of Nigeria, 6 shows a neighbourhood. */
export function cellFor(zoom: number): number {
  return [3, 1.6, 0.8, 0.35, 0.12, 0.04][Math.min(5, Math.max(0, Math.round(zoom) - 1))];
}

/** Showing a vacancy count for an area is allowed only when enough reports sit behind it that none can be traced to one address. */
export const MIN_AREA_COUNT = 3;
export function areaSafe(count: number): boolean { return count >= MIN_AREA_COUNT; }
