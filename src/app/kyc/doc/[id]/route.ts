import { NextResponse } from "next/server";
import { getSession, getMember } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { kycDocument } from "@/lib/services/kyc";

export const dynamic = "force-dynamic";

// A verification document: only for the agent who sent it, the company's top administrator (company checks) and reviewers.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return new NextResponse("Not found", { status: 404 });
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const member = await getMember();
  const doc = await kycDocument({ userId: session.user.id, companyId: member?.companyId ?? null, canManageCompany: !!member && can(member.role, "kyc.manage"), platformAdmin: session.user.isPlatformAdmin }, id).catch(() => null);
  if (!doc?.docBytes || !doc.docMime) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(doc.docBytes), { headers: {
    "Content-Type": doc.docMime, "Content-Disposition": `inline; filename="${doc.docName.replace(/[^\w.\- ]/g, "_") || "document"}"`,
    "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
  } });
}
