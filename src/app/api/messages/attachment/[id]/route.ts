import { getSession } from "@/lib/auth";
import { currentActor } from "@/lib/collab-session";
import { attachmentFor } from "@/lib/services/messaging";
import { isAudio, isImage } from "@/lib/chat-files";

export const dynamic = "force-dynamic";

/**
 * A chat file, for the people in the chat only. Pictures and voice notes open in place; documents always download. The browser is
 * told never to guess the type and never to run anything in it.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new Response("Sign in to open this file.", { status: 401 });
  const { id } = await params;
  const { actor } = await currentActor();
  const f = await attachmentFor(actor, id).catch(() => null);
  if (!f) return new Response("This file is not available.", { status: 404 });
  const inline = (isImage(f.mimeType) || isAudio(f.mimeType)) && new URL(req.url).searchParams.get("download") !== "1";
  const ascii = f.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const bytes = Buffer.from(f.bytes);
  const range = req.headers.get("range");
  const base: Record<string, string> = {
    "Content-Type": f.mimeType,
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Accept-Ranges": "bytes",
  };
  // Safari plays audio only when it can ask for parts of the file.
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
  if (m && (m[1] || m[2])) {
    const size = bytes.length;
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    return new Response(bytes.subarray(start, end + 1), { status: 206, headers: { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  return new Response(bytes, { headers: { ...base, "Content-Length": String(bytes.length) } });
}
