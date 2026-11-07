import { overpassQuery, parseOverpass, summariseNearby, overpassFailed, nearbyCell } from "./lib/location-rules.ts";
const SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const SPOTS: [string, number, number][] = [["Lekki Phase 1, Lagos", 6.4474, 3.4723], ["Ikeja GRA, Lagos", 6.5806, 3.3517], ["Independence Layout, Enugu", 6.4402, 7.5106], ["GRA Phase 2, Port Harcourt", 4.8156, 7.0100], ["Wuse 2, Abuja", 9.0790, 7.4700], ["Bodija, Ibadan", 7.4247, 3.9139]];
for (const [label, lat, lng] of SPOTS) {
  const c = nearbyCell({ lat, lng }).split(",").map(Number);
  const q = overpassQuery({ lat: c[0], lng: c[1] });
  for (const url of SERVERS) {
    const t = Date.now();
    try {
      const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 30000);
      const res = await fetch(url, { method: "POST", signal: ctrl.signal, headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": "Housy/1.0 (nearby places for property listings)" }, body: new URLSearchParams({ data: q }).toString() });
      clearTimeout(tm);
      const ms = Date.now() - t;
      if (!res.ok) { console.log(`${label} | ${url} | HTTP ${res.status} ${ms}ms ${(await res.text()).slice(0, 120).replace(/\s+/g, " ")}`); continue; }
      const j: any = await res.json();
      const s = summariseNearby({ lat, lng }, parseOverpass(j));
      console.log(`${label} | ${url} | ${ms}ms | elements ${j.elements?.length} | failed ${overpassFailed(j)} ${j.remark ?? ""}`);
      for (const k of s) console.log(`   ${k.label}: ${k.count} — ${k.nearest.map((n) => `${n.name} (${n.km.toFixed(1)} km)`).join("; ")}`);
      break;
    } catch (e) { console.log(`${label} | ${url} | error ${(e as Error).name} ${Date.now() - t}ms`); }
  }
}
