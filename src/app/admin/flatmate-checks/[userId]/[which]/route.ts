import { requirePlatformAdmin } from "@/lib/auth";
import { flatmateCheckImage } from "@/lib/services/flatmates";

export const dynamic = "force-dynamic";

/** One of the two flatmate ID check pictures, for a platform administrator only, never cached. */
export async function GET(_req: Request, { params }: { params: Promise<{ userId: string; which: string }> }) {
  // The same gate as the admin pages, including two-step sign-in when it is required.
  const admin = await requirePlatformAdmin();
  const { userId, which } = await params;
  if (which !== "doc" && which !== "selfie") return new Response("Not found", { status: 404 });
  const img = await flatmateCheckImage(admin.id, userId, which).catch(() => null);
  if (!img) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(img.bytes), { headers: { "Content-Type": img.type, "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" } });
}
