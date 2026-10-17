import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { importReportCsv } from "@/lib/services/imports";
import { headerSafeFilename } from "@/lib/security";

export const dynamic = "force-dynamic";

/** Every line of an import, what happened to it and why, for the administrator's records. */
export async function GET(_req: Request, { params: paramsP }: { params: Promise<{ id: string }> }) {
  const params = await paramsP;
  const member = await getMember();
  if (!member) return new NextResponse("Sign in first.", { status: 401 });
  if (!can(member.role, "import.manage")) return new NextResponse("Only the company administrator can see imports.", { status: 403 });
  const r = await importReportCsv(member, params.id);
  if (!r) return new NextResponse("Import not found.", { status: 404 });
  return new NextResponse(r.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${headerSafeFilename(r.ref).toLowerCase()}-report.csv"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
}
