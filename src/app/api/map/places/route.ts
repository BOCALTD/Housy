import { rateLimit } from "@/lib/ratelimit";
import { requestIp } from "@/lib/request-ip";
import { mapPlaces } from "@/lib/services/street-map";

export const dynamic = "force-dynamic";

// Places to jump to on the map: built-in areas and cities that have published listings. Public, read-only, rate limited.
export async function GET(req: Request) {
  if (!(await rateLimit(`mapq:${requestIp(req)}`, 120, 60_000))) return Response.json({ error: "Too many requests" }, { status: 429 });
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 60);
  return Response.json({ places: await mapPlaces(q) });
}
