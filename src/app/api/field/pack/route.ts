import { fieldMember } from "@/lib/field-api";
import { fieldPack } from "@/lib/services/field-kit";

export const dynamic = "force-dynamic";

// The signed-in inspector's open inspections, to record offline (getMember via fieldMember). Never cached.
export async function GET(req: Request) {
  const m = await fieldMember(req, false);
  // Not signed in is an ordinary answer here (the kit opens for anyone): say so without an error status.
  if (m instanceof Response) return m.status === 401 ? Response.json({ signedOut: true }, { headers: { "Cache-Control": "no-store" } }) : m;
  return Response.json(await fieldPack(m), { headers: { "Cache-Control": "no-store" } });
}
