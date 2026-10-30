import { rateLimit } from "@/lib/ratelimit";
import { requestIp } from "@/lib/request-ip";
import { nearbyForListing } from "@/lib/services/nearby";

export const dynamic = "force-dynamic";

// Schools, hospitals, markets and other places near a published property, from public map data. Public, read-only, rate limited.
export async function GET(req: Request) {
  if (!(await rateLimit(`nearby:${requestIp(req)}`, 60, 60_000))) return Response.json({ error: "Too many requests" }, { status: 429 });
  const ref = new URL(req.url).searchParams.get("ref") ?? "";
  if (!/^PROP-[A-Z0-9]{4,20}$/.test(ref)) return Response.json({ error: "ref must be a property reference" }, { status: 400 });
  return Response.json(await nearbyForListing(ref), { headers: { "Cache-Control": "public, max-age=3600" } });
}
