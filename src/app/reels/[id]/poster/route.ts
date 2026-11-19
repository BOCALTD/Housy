import { getSession } from "@/lib/auth";
import { reelMedia } from "@/lib/services/reels";

export const dynamic = "force-dynamic";

/** A reel's still picture (shown before the clip plays), once the clip has been prepared. */
export async function GET(_req: Request, { params: paramsP }: { params: Promise<{ id: string }> }) {
  const { id } = await paramsP;
  const session = await getSession();
  const v = await reelMedia(id, session?.user.id ?? null, "poster", null);
  if (!v) return new Response("Not found", { status: 404 });
  return new Response(v.body instanceof Uint8Array ? new Uint8Array(v.body) : v.body, { status: v.status, headers: v.headers });
}
