import { parseBounds } from "@/lib/geo-rules";
import { rateLimit } from "@/lib/ratelimit";
import { requestIp } from "@/lib/request-ip";
import { mapView } from "@/lib/services/street-map";

export const dynamic = "force-dynamic";

// Published listings inside the visible map area, at blurred positions. Public and read-only; rate limited per visitor.
export async function GET(req: Request) {
  if (!(await rateLimit(`map:${requestIp(req)}`, 240, 60_000))) return Response.json({ error: "Too many requests" }, { status: 429 });
  const q = new URL(req.url).searchParams;
  const b = parseBounds(q.get("bbox"));
  if (!b) return Response.json({ error: "bbox must be south,west,north,east" }, { status: 400 });
  const zoom = Math.max(0, Math.min(20, Number(q.get("zoom")) || 6));
  const view = await mapView(b, zoom, { purpose: q.get("purpose") ?? "", maxPrice: q.get("maxPrice") ?? "", minBeds: q.get("minBeds") ?? "", type: q.get("type") ?? "" });
  return Response.json(view, { headers: { "Cache-Control": "public, max-age=30" } });
}
