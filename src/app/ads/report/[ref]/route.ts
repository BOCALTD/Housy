import { NextResponse } from "next/server";
import { getMember, getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { headerSafeFilename } from "@/lib/security";
import { campaignReport, reportCsv } from "@/lib/services/ads";

export const dynamic = "force-dynamic";

/** A campaign's results as a spreadsheet, for the person who runs it or the platform administrator. */
export async function GET(_req: Request, { params: paramsP }: { params: Promise<{ ref: string }> }) {
  const params = await paramsP;
  const s = await getSession();
  if (!s) return new NextResponse("Sign in to download reports.", { status: 401 });
  let r = s.user.isPlatformAdmin ? await campaignReport({ admin: s.user.id }, params.ref) : await campaignReport({ payer: { userId: s.user.id, companyId: null, role: null } }, params.ref);
  if (!r && !s.user.isPlatformAdmin) {
    const m = await getMember();
    if (m && can(m.role, "billing.view")) r = await campaignReport({ payer: { userId: m.userId, companyId: m.companyId, role: m.role } }, params.ref);
  }
  if (!r) return new NextResponse("Campaign not found.", { status: 404 });
  return new NextResponse(reportCsv(r), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${headerSafeFilename(params.ref, "campaign")}-results.csv"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } });
}
