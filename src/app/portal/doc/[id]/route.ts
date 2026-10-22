import { NextResponse } from "next/server";
import { getSession, getMember } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { submissionDocForCompany, submissionDocForVendor } from "@/lib/services/portals";

export const dynamic = "force-dynamic";

// A document a vendor attached to a quotation, invoice or completion report: for that vendor and the company's maintenance managers.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  let doc = await submissionDocForVendor(session.user.id, id).catch(() => null);
  if (!doc) {
    const member = await getMember();
    if (member && !member.companySuspended && can(member.role, "maintenance.manage")) doc = await submissionDocForCompany(member, id).catch(() => null);
  }
  if (!doc?.docBytes || !doc.docMime) return new NextResponse("Not found", { status: 404 });
  return send(doc.docBytes, doc.docMime, doc.docName);
}

function send(bytes: Uint8Array, mime: string, name: string) {
  return new NextResponse(new Uint8Array(bytes), { headers: {
    "Content-Type": mime, "Content-Disposition": `inline; filename="${name.replace(/[^\w.\- ]/g, "_") || "document"}"`,
    "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
  } });
}
