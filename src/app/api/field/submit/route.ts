import { fieldError, fieldMember } from "@/lib/field-api";
import { submitFromDevice } from "@/lib/services/field-kit";

export const dynamic = "force-dynamic";

// Submit an inspection for approval after its offline record is sent (getMember via fieldMember, same-origin only).
export async function POST(req: Request) {
  const m = await fieldMember(req, true);
  if (m instanceof Response) return m;
  try {
    const body = (await req.json().catch(() => ({}))) as { inspectionId?: unknown };
    return Response.json(await submitFromDevice(m, String(body.inspectionId ?? "")), { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return fieldError(e); }
}
