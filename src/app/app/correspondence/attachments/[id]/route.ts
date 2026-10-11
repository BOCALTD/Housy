import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getCorrespondenceAttachment } from "@/lib/services/correspondence";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const member = await getMember();
  if (!member) return new NextResponse("Sign in to download attachments.", { status: 401 });
  if (!can(member.role, "correspondence.view")) return new NextResponse("You do not have access to correspondence.", { status: 403 });
  const result = await getCorrespondenceAttachment(member, params.id);
  if (!result) return new NextResponse("Attachment not found.", { status: 404 });
  const safeName = result.att.fileName.replace(/[^\w.\- ]+/g, "_");
  return new NextResponse(new Uint8Array(result.bytes), {
    headers: {
      "Content-Type": result.att.mimeType,
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
