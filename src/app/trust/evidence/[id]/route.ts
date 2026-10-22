import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { caseEvidence } from "@/lib/services/trust-cases";

export const dynamic = "force-dynamic";

// Evidence attached to a Trust and Safety report: for the person who sent it and for platform administrators only.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const f = await caseEvidence({ userId: session.user.id, platformAdmin: session.user.isPlatformAdmin }, id).catch(() => null);
  if (!f) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(f.bytes), { headers: { "Content-Type": f.mimeType, "Content-Disposition": `inline; filename="${f.name.replace(/[^\w.\- ]/g, "_")}"`, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "private, no-store" } });
}
