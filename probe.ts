import { AMENITY_KINDS, overpassQuery, parseOverpass, summariseNearby } from "./lib/location-rules.ts";
const UA = "Housy/1.0 (+https://github.com/BOCALTD/Housy; nearby places)";
const esc = (v: string) => v.replace(/[^a-z0-9_]/gi, "");
const box = (lat: number, lng: number, m: number) => { const dLat = m / 111320, dLng = m / (111320 * Math.cos(lat * Math.PI / 180)); return `${(lat - dLat).toFixed(5)},${(lng - dLng).toFixed(5)},${(lat + dLat).toFixed(5)},${(lng + dLng).toFixed(5)}`; };
function bboxPerKind(lat: number, lng: number, el = "nwr", slack = 800, everydayKm?: number) {
  return `[out:json][timeout:25];` + AMENITY_KINDS.map((k) => {
    const km = k.kind === "landmark" ? k.km : (everydayKm ?? k.km);
    const b = box(lat, lng, km * 1000 + slack);
    const sel = k.tags.map(([key, values]) => `${el}["${esc(key)}"~"^(${values.map(esc).join("|")})$"]${k.named ? '["name"]' : ""}(${b});`).join("");
    return `(${sel});out tags center qt ${k.kind === "transport" || k.kind === "food" || k.kind === "shopping" ? 300 : 150};`;
  }).join("");
}
function bboxByKey(lat: number, lng: number) {
  // everyday: one statement per key over the 2.8 km box, all values; landmarks separately (named) over 5.8 km
  const b = box(lat, lng, 2800), bl = box(lat, lng, 5800);
  const keys = new Map<string, Set<string>>();
  for (const k of AMENITY_KINDS) if (k.kind !== "landmark") for (const [key, vals] of k.tags) { const s = keys.get(key) ?? new Set(); vals.forEach((v) => s.add(v)); keys.set(key, s); }
  const lm = AMENITY_KINDS.find((k) => k.kind === "landmark")!;
  return `[out:json][timeout:25];(` + [...keys].map(([key, vals]) => `nw["${key}"~"^(${[...vals].join("|")})$"](${b});`).join("") + `);out tags center qt 1500;(` + lm.tags.map(([key, vals]) => `nw["${key}"~"^(${vals.join("|")})$"]["name"](${bl});`).join("") + `);out tags center qt 200;`;
}
const SPOTS: [string, number, number][] = [["Lekki Phase 1", 6.45, 3.47], ["Ikeja GRA", 6.58, 3.35], ["Port Harcourt GRA", 4.82, 7.01]];
const variants: [string, (a: number, b: number) => string][] = [
  ["A around (current)", (a, b) => overpassQuery({ lat: a, lng: b })],
  ["B bbox nwr per kind", (a, b) => bboxPerKind(a, b)],
  ["C bbox nw per kind", (a, b) => bboxPerKind(a, b, "nw")],
  ["D bbox nw by key", (a, b) => bboxByKey(a, b)],
  ["E bbox nw per kind, everyday 1.5km", (a, b) => bboxPerKind(a, b, "nw", 800, 1.5)],
];
async function run(label: string, q: string, lat: number, lng: number) {
  const t = Date.now();
  try {
    const c = new AbortController(); const tm = setTimeout(() => c.abort(), 40000);
    const r = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", signal: c.signal, headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA }, body: new URLSearchParams({ data: q }).toString() });
    clearTimeout(tm);
    const txt = await r.text();
    if (!r.ok) return console.log(`${label} | HTTP ${r.status} ${Date.now() - t}ms ${txt.slice(0, 90).replace(/\s+/g, " ")}`);
    const j = JSON.parse(txt);
    const s = summariseNearby({ lat, lng }, parseOverpass(j));
    console.log(`${label} | ${Date.now() - t}ms | ${txt.length} bytes | ${j.remark ?? ""} | ${s.map((k) => `${k.kind}:${k.count}`).join(" ")}`);
    const lm = s.find((k) => k.kind === "landmark"); if (lm) console.log(`    landmarks: ${lm.nearest.map((n) => `${n.name} ${n.km.toFixed(1)}km`).join("; ")}`);
  } catch (e) { console.log(`${label} | ${(e as Error).name} ${Date.now() - t}ms`); }
}
const status = async () => { try { const r = await fetch("https://overpass-api.de/api/status", { headers: { "User-Agent": UA } }); console.log("status:", (await r.text()).split("\n").slice(0, 6).join(" | ")); } catch {} };
for (const [name, lat, lng] of SPOTS) {
  console.log(`== ${name}`);
  for (const [v, f] of variants) { await status(); await run(v, f(lat, lng), lat, lng); await new Promise((r) => setTimeout(r, 4000)); }
}
