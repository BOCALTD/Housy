import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { messageFor } from "@/lib/forms";
import { ownerStatement } from "@/lib/services/portals";
import { renderStatement } from "@/lib/statement-pdf";
import { pdfResponse } from "@/lib/pdf-response";

export const dynamic = "force-dynamic";

// The owner's statement as a PDF, for the properties on their grant only.
export async function GET(req: Request, { params }: { params: Promise<{ grantId: string }> }) {
  const { grantId } = await params;
  const session = await getSession();
  if (!session || !/^[0-9a-f-]{36}$/.test(grantId)) return new NextResponse("Not found", { status: 404 });
  const q = new URL(req.url).searchParams;
  try {
    const data = await ownerStatement(session.user.id, grantId, q.get("from"), q.get("to"));
    if (!data) return new NextResponse("Not found", { status: 404 });
    return pdfResponse(renderStatement(data), `statement-${data.from}-to-${data.to}.pdf`);
  } catch (err) {
    return NextResponse.redirect(new URL(`/portal/owner/${grantId}?error=${encodeURIComponent(messageFor(err))}#statement`, req.url), 303);
  }
}
