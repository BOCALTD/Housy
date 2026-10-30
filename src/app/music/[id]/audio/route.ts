import { trackAudio } from "@/lib/services/music";

export const dynamic = "force-dynamic";

/** A track from the music library, with byte ranges for phones. Public: only switched-on tracks are served. */
export async function GET(req: Request, { params: paramsP }: { params: Promise<{ id: string }> }) {
  const { id } = await paramsP;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const a = await trackAudio(id);
  if (!a) return new Response("Not found", { status: 404 });
  const size = a.bytes.byteLength;
  const base = { "Content-Type": a.type, "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (!m || (m[1] === "" && m[2] === "")) return new Response(new Uint8Array(a.bytes), { status: 200, headers: { ...base, "Content-Length": String(size) } });
  const start = m[1] === "" ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  const end = m[1] === "" || m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${size}` } });
  return new Response(new Uint8Array(a.bytes.subarray(start, end + 1)), { status: 206, headers: { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
}
