import { rateLimit } from "@/lib/ratelimit";
import { requestIp } from "@/lib/request-ip";
import { travelToListing } from "@/lib/services/nearby";

export const dynamic = "force-dynamic";

// How long it takes to get from a place the visitor chose to a published property. The visitor's point is used for this answer
// only and is not stored. Public, read-only, rate limited.
export async function GET(req: Request) {
  if (!(await rateLimit(`travel:${requestIp(req)}`, 60, 60_000))) return Response.json({ error: "Too many requests" }, { status: 429 });
  const q = new URL(req.url).searchParams;
  const ref = q.get("ref") ?? "";
  const [lat, lng] = (q.get("from") ?? "").split(",").map(Number);
  if (!/^PROP-[A-Z0-9]{4,20}$/.test(ref) || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) {
    return Response.json({ error: "ref and from=lat,lng are needed" }, { status: 400 });
  }
  const r = await travelToListing(ref, { lat, lng });
  if (!r) return Response.json({ error: "Property not found" }, { status: 404 });
  return Response.json(r, { headers: { "Cache-Control": "private, no-store" } });
}
