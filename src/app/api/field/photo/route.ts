import { fieldError, fieldMember } from "@/lib/field-api";
import { syncFieldPhoto } from "@/lib/services/field-kit";

export const dynamic = "force-dynamic";
const MAX_BYTES = 8 * 1024 * 1024;

// A photograph taken offline (getMember via fieldMember, same-origin only), sent once per device id.
export async function POST(req: Request) {
  const m = await fieldMember(req, true);
  if (m instanceof Response) return m;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return Response.json({ error: "That photo is too large" }, { status: 413 });
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES) return Response.json({ error: "Attach one photo" }, { status: 400 });
    const s = (k: string) => { const v = form.get(k); return typeof v === "string" ? v : ""; };
    const out = await syncFieldPhoto(m, { clientId: s("clientId"), inspectionId: s("inspectionId"), findingId: s("findingId") || null, caption: s("caption") },
      { name: file.name || "site-photo.jpg", type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
    return Response.json(out, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return fieldError(e); }
}
