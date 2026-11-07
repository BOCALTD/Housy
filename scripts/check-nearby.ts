/**
 * Can this machine get nearby places from the public map servers? Run it on the server (or your own computer):
 *   npm run check:nearby                 (Lekki Phase 1, Lagos)
 *   npm run check:nearby -- 4.8156,7.0100 (any position: latitude,longitude)
 * It asks exactly what the property page asks, names the site the same way, and prints what each server answered and
 * what was found. Nothing is saved.
 */
import { tuneNetwork } from "../src/lib/network";
import { nearbyCell, overpassFailed, overpassQuery, overpassServers, overpassUserAgent as userAgent, parseOverpass, summariseNearby } from "../src/lib/location-rules";

tuneNetwork(); // the same connection settings as the server
const arg = process.argv.slice(2).find((a) => /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(a));
const [lat, lng] = (arg ?? "6.4474,3.4723").split(",").map(Number);
const [clat, clng] = nearbyCell({ lat, lng }).split(",").map(Number);
const query = overpassQuery({ lat: clat, lng: clng });
const ua = userAgent(process.env);
console.log(`Looking around ${lat}, ${lng} as: ${ua}\n`);

/** The reason a connection failed, in words, with the system's own code so it can be looked up. */
function why(e: unknown): string {
  const c = (e as { cause?: { code?: string; message?: string; errors?: { code?: string }[] } }).cause;
  const code = c?.code ?? c?.errors?.[0]?.code ?? "";
  const words: Record<string, string> = {
    ENOTFOUND: "this machine could not look up the server's address (DNS)",
    EAI_AGAIN: "this machine could not look up the server's address (DNS) just now",
    ECONNREFUSED: "the connection was refused",
    ECONNRESET: "the connection was cut",
    ETIMEDOUT: "the connection timed out",
    ENETUNREACH: "this machine has no route to the internet for that address",
    EHOSTUNREACH: "this machine has no route to that server",
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "the secure connection could not be checked (a proxy or antivirus may be in the way)",
    SELF_SIGNED_CERT_IN_CHAIN: "the secure connection could not be checked (a proxy or antivirus may be in the way)",
    CERT_HAS_EXPIRED: "the secure connection could not be checked (check this machine's clock)",
    UND_ERR_CONNECT_TIMEOUT: "the connection timed out",
  };
  return `${words[code] ?? (c?.message || (e as Error).message || "unknown")}${code ? ` [${code}]` : ""}`;
}

async function main() {
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
      console.log(`✗ ${url}\n  ${(e as Error).name === "AbortError" ? "no answer within 30 seconds" : `could not connect: ${why(e)}`} (${Date.now() - t} ms)\n`);
    }
  }
  console.log(found ? "\nNearby places work from this machine." : "\nNo map server answered from this machine. Check the internet connection (the reasons above say what failed), or set OVERPASS_URL to a server you run or pay for.");
  return found;
}

main().then((found) => process.exit(found ? 0 : 1), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
