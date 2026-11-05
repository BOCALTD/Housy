import { postCover } from "@/lib/services/blog";

/** The cover of a published blog post (the database returns nothing for drafts). */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const c = await postCover((await params).slug).catch(() => null);
  if (!c) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(c.bytes), { headers: { "content-type": c.type, "cache-control": "public, max-age=86400, stale-while-revalidate=604800", "x-content-type-options": "nosniff", "last-modified": c.updatedAt.toUTCString() } });
}
