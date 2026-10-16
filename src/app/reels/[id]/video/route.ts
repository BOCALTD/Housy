import { getSession } from "@/lib/auth";
import { reelVideo } from "@/lib/services/reels";

export const dynamic = "force-dynamic";

/** Serves a clip with byte ranges, which iPhones need before they will play or scrub a video. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  const v = await reelVideo(params.id, session?.user.id ?? null);
  if (!v) return new Response("Not found", { status: 404 });
  const size = v.bytes.byteLength;
  const base = { "Content-Type": v.type, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (!m || (m[1] === "" && m[2] === "")) return new Response(new Uint8Array(v.bytes), { status: 200, headers: { ...base, "Content-Length": String(size) } });
  let start = m[1] === "" ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  let end = m[1] === "" || m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${size}` } });
  end = Math.min(end, size - 1); start = Math.max(0, start);
  return new Response(new Uint8Array(v.bytes.subarray(start, end + 1)), { status: 206, headers: { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
}
