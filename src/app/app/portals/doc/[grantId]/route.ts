import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { vendorProfileForCompany } from "@/lib/services/portals";

export const dynamic = "force-dynamic";

// A vendor's compliance document, for the company that invited it.
export async function GET(_req: Request, { params }: { params: Promise<{ grantId: string }> }) {
  const { grantId } = await params;
  const member = await getMember();
  if (!member || member.companySuspended || !can(member.role, "portal.manage") || !/^[0-9a-f-]{36}$/.test(grantId)) return new NextResponse("Not found", { status: 404 });
  const p = await vendorProfileForCompany(member, grantId).catch(() => null);
  if (!p?.docBytes || !p.docMime) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(p.docBytes), { headers: {
    "Content-Type": p.docMime, "Content-Disposition": `inline; filename="${p.docName.replace(/[^\w.\- ]/g, "_") || "document"}"`,
    "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
  } });
}
