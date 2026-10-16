import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { IMPORT_KINDS, templateCsv, type ImportKindName } from "@/lib/import-rules";

export const dynamic = "force-dynamic";

/** A blank spreadsheet with the right headings and one example line. */
export async function GET(_req: Request, { params }: { params: { kind: string } }) {
  const member = await getMember();
  if (!member) return new NextResponse("Sign in first.", { status: 401 });
  if (!can(member.role, "import.manage")) return new NextResponse("Only the company administrator can import records.", { status: 403 });
  const kind = params.kind.toUpperCase() as ImportKindName;
  if (!(IMPORT_KINDS as readonly string[]).includes(kind)) return new NextResponse("Unknown template.", { status: 404 });
  return new NextResponse(templateCsv(kind), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="import-${kind.toLowerCase()}-template.csv"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
}
