import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getDocumentForDownload } from "@/lib/services/assets";

// Documents are only served through this authorized route, never from a public folder.
export async function GET(_req: Request, { params: paramsP }: { params: Promise<{ id: string }> }) {
  const params = await paramsP;
  const member = await getMember();
  if (!member) return new NextResponse("Sign in to download documents.", { status: 401 });
  if (!can(member.role, "document.download")) return new NextResponse("You do not have access to documents.", { status: 403 });
  const result = await getDocumentForDownload(member, params.id);
  if (!result) return new NextResponse("Document not found.", { status: 404 });
  const safeName = result.doc.fileName.replace(/[^\w.\- ]+/g, "_");
  return new NextResponse(new Uint8Array(result.bytes), {
    headers: {
      "Content-Type": result.doc.mimeType,
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
