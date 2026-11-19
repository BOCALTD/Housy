import { getSession } from "@/lib/auth";
import { reelMedia } from "@/lib/services/reels";

export const dynamic = "force-dynamic";

/** Serves a clip with byte ranges, which iPhones need before they will play or scrub a video, from wherever it is kept. */
export async function GET(req: Request, { params: paramsP }: { params: Promise<{ id: string }> }) {
  const { id } = await paramsP;
  const session = await getSession();
  const v = await reelMedia(id, session?.user.id ?? null, "video", req.headers.get("range"));
  if (!v) return new Response("Not found", { status: 404 });
  return new Response(v.body instanceof Uint8Array ? new Uint8Array(v.body) : v.body, { status: v.status, headers: v.headers });
}
