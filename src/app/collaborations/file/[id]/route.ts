import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { currentActor } from "@/lib/collab-session";
import { getSharedFile } from "@/lib/services/collab";

// Shared documents are served only through this route, and only to people in the workspace.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!(await getSession())) return new NextResponse("Sign in to view documents.", { status: 401 });
  const { actor } = await currentActor();
  let result;
  try { result = await getSharedFile(actor, params.id); } catch { return new NextResponse("Not available.", { status: 403 }); }
  if (!result) return new NextResponse("Document not found, or it was taken back.", { status: 404 });
  const safeName = (result.item.fileName ?? "document").replace(/[^\w.\- ]/g, "_");
  return new NextResponse(new Uint8Array(result.bytes), {
    headers: {
      "Content-Type": result.item.mimeType ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
}
