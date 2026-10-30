import { fieldError, fieldMember } from "@/lib/field-api";
import { syncFieldRecord } from "@/lib/services/field-kit";

export const dynamic = "force-dynamic";
const MAX_BYTES = 512 * 1024;

// A record made offline (getMember via fieldMember, same-origin only). Safe to resend: the device's id makes it apply once.
export async function POST(req: Request) {
  const m = await fieldMember(req, true);
  if (m instanceof Response) return m;
  const body = await req.text();
  if (body.length > MAX_BYTES) return Response.json({ error: "That record is too large to send" }, { status: 413 });
  try { return Response.json(await syncFieldRecord(m, JSON.parse(body)), { headers: { "Cache-Control": "no-store" } }); }
  catch (e) { return fieldError(e); }
}
