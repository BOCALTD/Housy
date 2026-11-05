import { profileImage } from "@/lib/services/profile";

export const dynamic = "force-dynamic";

/** A person's profile photo or cover photo. Shown wherever they appear; nothing for someone on a break or without one. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await params;
  if ((kind !== "avatar" && kind !== "cover") || !/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const img = await profileImage(id, kind).catch(() => null);
  if (!img) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(new Uint8Array(img.bytes), {
    headers: { "Content-Type": img.type, "Cache-Control": "public, max-age=86400, immutable", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" },
  });
}
