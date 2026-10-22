import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { messageFor } from "@/lib/forms";
import { ownerStatementForCompany } from "@/lib/services/portals";
import { renderStatement } from "@/lib/statement-pdf";
import { pdfResponse } from "@/lib/pdf-response";

export const dynamic = "force-dynamic";

// A company preparing an owner's statement: the same document the owner can download for themselves.
export async function GET(req: Request, { params }: { params: Promise<{ grantId: string }> }) {
  const { grantId } = await params;
  const member = await getMember();
  if (!member || member.companySuspended || !can(member.role, "portal.manage") || !/^[0-9a-f-]{36}$/.test(grantId)) return new NextResponse("Not found", { status: 404 });
  const q = new URL(req.url).searchParams;
  try {
    const data = await ownerStatementForCompany(member, grantId, q.get("from"), q.get("to"));
    if (!data) return new NextResponse("Not found", { status: 404 });
    return pdfResponse(renderStatement(data), `statement-${data.ownerName}-${data.from}-to-${data.to}.pdf`);
  } catch (err) {
    return NextResponse.redirect(new URL(`/app/portals?error=${encodeURIComponent(messageFor(err))}`, req.url), 303);
  }
}
