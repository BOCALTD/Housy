import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { getProjectDocument } from "@/lib/services/project-handover";

// Project documents are served only through this authorized route.
export async function GET(_req: Request, { params: paramsP }: { params: Promise<{ id: string }> }) {
  const params = await paramsP;
  const member = await getMember();
  if (!member) return new NextResponse("Sign in to view documents.", { status: 401 });
  let result;
  try {
    result = await getProjectDocument(member, params.id);
  } catch {
    return new NextResponse("You do not have access to project documents.", { status: 403 });
  }
  if (!result) return new NextResponse("Document not found.", { status: 404 });
  const safeName = result.doc.fileName.replace(/[^\w.\- ]/g, "_");
  return new NextResponse(new Uint8Array(result.bytes), {
    headers: {
      "Content-Type": result.doc.mimeType,
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
}
