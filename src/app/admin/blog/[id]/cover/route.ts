import { requirePlatformAdmin } from "@/lib/auth";
import { adminCover } from "@/lib/services/blog";

/** A draft's cover, for the administrator's preview. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await requirePlatformAdmin();
  const c = await adminCover(a.id, (await params).id).catch(() => null);
  if (!c) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(c.bytes), { headers: { "content-type": c.type, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}
