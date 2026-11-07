/**
 * Can this machine get nearby places from the public map servers? Run it on the server (or your own computer):
 *   npm run check:nearby                 (Lekki Phase 1, Lagos)
 *   npm run check:nearby -- 4.8156,7.0100 (any position: latitude,longitude)
 * It asks exactly what the property page asks, names the site the same way, and prints what each server answered and
 * what was found. Nothing is saved.
 */
import { nearbyCell, overpassFailed, overpassQuery, overpassServers, overpassUserAgent as userAgent, parseOverpass, summariseNearby } from "../src/lib/location-rules";

const arg = process.argv.slice(2).find((a) => /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(a));
const [lat, lng] = (arg ?? "6.4474,3.4723").split(",").map(Number);
const [clat, clng] = nearbyCell({ lat, lng }).split(",").map(Number);
const query = overpassQuery({ lat: clat, lng: clng });
const ua = userAgent(process.env);
console.log(`Looking around ${lat}, ${lng} as: ${ua}\n`);

let found = false;
for (const url of overpassServers(process.env)) {
  const t = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    const res = await fetch(url, { method: "POST", signal: ctrl.signal, headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": ua }, body: new URLSearchParams({ data: query }).toString() });
    clearTimeout(timer);
    const text = await res.text();
    const ms = Date.now() - t;
    if (!res.ok) {
      const why = res.status === 406 ? "refused: the server does not accept requests from this machine or this name"
        : res.status === 429 ? "too many requests from this machine just now" : res.status >= 500 ? "the server is busy" : "refused";
      console.log(`✗ ${url}\n  ${res.status} after ${ms} ms (${why})\n`);
      continue;
    }
    const json: unknown = JSON.parse(text);
    if (overpassFailed(json)) { console.log(`✗ ${url}\n  answered after ${ms} ms but ran out of time\n`); continue; }
    const summary = summariseNearby({ lat, lng }, parseOverpass(json));
    console.log(`✓ ${url}\n  answered in ${ms} ms\n`);
    for (const s of summary) console.log(`  ${s.label} (${s.count}): ${s.nearest.map((n) => `${n.name}, ${n.km.toFixed(1)} km`).join("; ")}`);
    if (!summary.length) console.log("  Nothing is recorded around here on the public map.");
    found = true;
    break;
  } catch (e) {
    console.log(`✗ ${url}\n  ${(e as Error).name === "AbortError" ? "no answer within 30 seconds" : "could not connect"} (${Date.now() - t} ms)\n`);
  }
}
console.log(found ? "\nNearby places work from this machine." : "\nNo map server answered from this machine. Check the internet connection, or set OVERPASS_URL to a server you run or pay for.");
process.exit(found ? 0 : 1);
