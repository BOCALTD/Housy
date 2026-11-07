import { overpassQuery, parseOverpass, summariseNearby, overpassFailed, nearbyCell } from "./lib/location-rules.ts";
const UA = "Housy/1.0 (+https://github.com/BOCALTD/Housy; property listings: nearby places)";
const SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const SPOTS: [string, number, number][] = [["Lekki Phase 1, Lagos", 6.4474, 3.4723], ["Ikeja GRA, Lagos", 6.5806, 3.3517], ["Independence Layout, Enugu", 6.4402, 7.5106], ["GRA Phase 2, Port Harcourt", 4.8156, 7.0100], ["Wuse 2, Abuja", 9.0790, 7.4700]];
for (const [label, lat, lng] of SPOTS) {
  const c = nearbyCell({ lat, lng }).split(",").map(Number);
  const q = overpassQuery({ lat: c[0], lng: c[1] });
  let done = false;
  for (let attempt = 0; attempt < 3 && !done; attempt++) for (const url of SERVERS) {
    const t = Date.now();
    try {
      const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 30000);
      const res = await fetch(url, { method: "POST", signal: ctrl.signal, headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": UA }, body: new URLSearchParams({ data: q }).toString() });
      clearTimeout(tm);
      const txt = await res.text();
      if (!res.ok) { console.log(`${label} | ${url} | HTTP ${res.status} ${Date.now() - t}ms ${txt.slice(0, 100).replace(/\s+/g, " ")}`); continue; }
      const j = JSON.parse(txt);
      console.log(`${label} | ${url} | ${Date.now() - t}ms | elements ${j.elements?.length} | failed ${overpassFailed(j)}`);
      if (overpassFailed(j)) continue;
      for (const k of summariseNearby({ lat, lng }, parseOverpass(j))) console.log(`   ${k.label}: ${k.count} — ${k.nearest.map((n) => `${n.name} (${n.km.toFixed(1)} km)`).join("; ")}`);
      done = true; break;
    } catch (e) { console.log(`${label} | ${url} | ${(e as Error).name} ${(e as Error).cause ? String((e as Error).cause).slice(0, 80) : ""} ${Date.now() - t}ms`); }
    await new Promise((r) => setTimeout(r, 3000));
  }
}
