import { overpassQuery, parseOverpass, summariseNearby } from "./lib/location-rules.ts";
const tiny = `[out:json][timeout:10];node["amenity"="school"](around:500,6.45,3.47);out 3;`;
const full = overpassQuery({ lat: 6.45, lng: 3.47 });
const UAS: Record<string, string | undefined> = { none: undefined, housy: "Housy/1.0 (nearby places for property listings)", contact: "Housy/1.0 (+https://github.com/BOCALTD/Housy; nearby places)", browserish: "Mozilla/5.0 (compatible; Housy/1.0; +https://github.com/BOCALTD/Housy)" };
const SERVERS = ["https://overpass-api.de/api/interpreter", "https://lz4.overpass-api.de/api/interpreter", "https://z.overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.osm.jp/api/interpreter"];
async function go(label: string, url: string, init: RequestInit, ms = 25000) {
  const t = Date.now();
  try {
    const c = new AbortController(); const tm = setTimeout(() => c.abort(), ms);
    const r = await fetch(url, { ...init, signal: c.signal }); clearTimeout(tm);
    const txt = await r.text();
    let extra = "";
    try { const j = JSON.parse(txt); extra = `elements ${j.elements?.length} ${j.remark ?? ""}`; if (j.elements?.length > 20) extra += " | " + summariseNearby({ lat: 6.4474, lng: 3.4723 }, parseOverpass(j)).map((k) => `${k.label} ${k.count}`).join(", "); } catch { extra = txt.slice(0, 90).replace(/\s+/g, " "); }
    console.log(`${label} | HTTP ${r.status} ${Date.now() - t}ms | ${extra}`);
  } catch (e) { console.log(`${label} | ${(e as Error).name} ${Date.now() - t}ms`); }
}
const post = (q: string, ua?: string, accept?: string): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...(ua ? { "User-Agent": ua } : {}), ...(accept ? { Accept: accept } : {}) }, body: new URLSearchParams({ data: q }).toString() });
console.log("== headers on overpass-api.de, tiny query");
for (const [k, ua] of Object.entries(UAS)) { await go(`ua=${k}`, SERVERS[0], post(tiny, ua)); await go(`ua=${k} accept=json`, SERVERS[0], post(tiny, ua, "application/json")); }
await go("GET contact", SERVERS[0] + "?data=" + encodeURIComponent(tiny), { headers: { "User-Agent": UAS.contact! } });
console.log("== servers, tiny then full, contact UA");
for (const s of SERVERS) { await go(`tiny ${s}`, s, post(tiny, UAS.contact)); await go(`full ${s}`, s, post(full, UAS.contact), 40000); }
