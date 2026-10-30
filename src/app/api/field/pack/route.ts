import { fieldMember } from "@/lib/field-api";
import { fieldPack } from "@/lib/services/field-kit";

export const dynamic = "force-dynamic";

// The signed-in inspector's open inspections, to record offline (getMember via fieldMember). Never cached.
export async function GET(req: Request) {
  const m = await fieldMember(req, false);
  if (m instanceof Response) return m;
  return Response.json(await fieldPack(m), { headers: { "Cache-Control": "no-store" } });
}
