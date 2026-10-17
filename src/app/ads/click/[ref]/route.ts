import { safeLocalPath } from "@/lib/security";
import { getSession } from "@/lib/auth";
import { recordClick, viewerKeyFor } from "@/lib/services/ads";

export const dynamic = "force-dynamic";

/**
 * An advert was clicked. The visitor always reaches the property. Whether the advertiser is charged is decided by the service: only a
 * live advert, a real person who is not the advertiser's own, and the first click from that visitor today.
 */
export async function GET(req: Request, { params: paramsP }: { params: Promise<{ ref: string }> }) {
  const params = await paramsP;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const ua = req.headers.get("user-agent") ?? "";
  const session = await getSession().catch(() => null);
  let to = "/";
  try { to = (await recordClick(params.ref, { viewerKey: viewerKeyFor(ip, ua), userId: session?.user.id ?? null, ua })).to; } catch (e) { console.error("ad click failed", e); }
  return new Response(null, { status: 302, headers: { Location: safeLocalPath(to, "/"), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

/** Link previews and crawlers ask with HEAD. They are not clicks. */
export async function HEAD() {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
