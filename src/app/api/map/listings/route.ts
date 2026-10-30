import { parseBounds } from "@/lib/geo-rules";
import { rateLimit } from "@/lib/ratelimit";
import { requestIp } from "@/lib/request-ip";
import { mapNear, mapView } from "@/lib/services/street-map";
import { parseNear } from "@/lib/location-rules";

export const dynamic = "force-dynamic";

// Published listings inside the visible map area, at blurred positions. Public and read-only; rate limited per visitor.
export async function GET(req: Request) {
  if (!(await rateLimit(`map:${requestIp(req)}`, 240, 60_000))) return Response.json({ error: "Too many requests" }, { status: 429 });
  const q = new URL(req.url).searchParams;
  const filters = { purpose: q.get("purpose") ?? "", maxPrice: q.get("maxPrice") ?? "", minBeds: q.get("minBeds") ?? "", type: q.get("type") ?? "" };
  // Radius search: ?near=lat,lng&km=5 (1, 2, 5, 10, 20 or 50 km).
  if (q.has("near")) {
    const n = parseNear(q.get("near"), q.get("km"));
    if (!n) return Response.json({ error: "near must be lat,lng and km one of 1, 2, 5, 10, 20, 50" }, { status: 400 });
    const zoom = Math.max(0, Math.min(20, Number(q.get("zoom")) || 12));
    return Response.json(await mapNear(n.centre, n.km, zoom, filters), { headers: { "Cache-Control": "public, max-age=30" } });
  }
  const b = parseBounds(q.get("bbox"));
  if (!b) return Response.json({ error: "bbox must be south,west,north,east" }, { status: 400 });
  const zoom = Math.max(0, Math.min(20, Number(q.get("zoom")) || 6));
  const view = await mapView(b, zoom, filters);
  return Response.json(view, { headers: { "Cache-Control": "public, max-age=30" } });
}
