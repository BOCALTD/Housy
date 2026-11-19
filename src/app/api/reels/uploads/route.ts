import { startUpload, uploadLimits } from "@/lib/services/reel-media";
import { uploadError, uploader } from "@/lib/upload-api";

export const dynamic = "force-dynamic";

/** What may be sent (size, piece size, whether the server prepares clips). */
export async function GET(req: Request) {
  const u = await uploader(req, false);
  if (u instanceof Response) return u;
  return Response.json(await uploadLimits(), { headers: { "Cache-Control": "no-store" } });
}

/** Start sending a reel clip in pieces: { type, size, name }. */
export async function POST(req: Request) {
  const u = await uploader(req, true);
  if (u instanceof Response) return u;
  try {
    const b = (await req.json().catch(() => ({}))) as { type?: unknown; size?: unknown; name?: unknown };
    const out = await startUpload(u, { type: String(b.type ?? ""), size: Number(b.size), name: String(b.name ?? "") });
    return Response.json(out, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return uploadError(e); }
}
