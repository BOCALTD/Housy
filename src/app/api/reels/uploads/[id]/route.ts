import { appendChunk, uploadStatus } from "@/lib/services/reel-media";
import { REEL_CHUNK_BYTES } from "@/lib/social-rules";
import { uploadError, uploader } from "@/lib/upload-api";

export const dynamic = "force-dynamic";

/** How much has arrived, to carry on after a dropped connection. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await uploader(req, false);
  if (u instanceof Response) return u;
  const s = await uploadStatus(u, (await params).id);
  return s ? Response.json(s, { headers: { "Cache-Control": "no-store" } }) : Response.json({ error: "This upload has expired. Choose the video again." }, { status: 404 });
}

/** The next piece, at the offset in the Upload-Offset header. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await uploader(req, true);
  if (u instanceof Response) return u;
  const offset = Number(req.headers.get("upload-offset"));
  if (!Number.isInteger(offset) || offset < 0) return Response.json({ error: "Send the piece's place in the video" }, { status: 400 });
  if (Number(req.headers.get("content-length") ?? 0) > REEL_CHUNK_BYTES) return Response.json({ error: "That piece is too large" }, { status: 413 });
  try {
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.byteLength) return Response.json({ error: "The piece was empty" }, { status: 400 });
    return Response.json(await appendChunk(u, (await params).id, offset, bytes), { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return uploadError(e); }
}
