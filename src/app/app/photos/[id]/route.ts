import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { getPhotoForDownload } from "@/lib/services/photos";

// Photographs are only served through this authorized route, never from a public folder.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const member = await getMember();
  if (!member) return new NextResponse("Sign in to view photographs.", { status: 401 });
  let result;
  try {
    result = await getPhotoForDownload(member, params.id);
  } catch {
    return new NextResponse("You do not have access to photographs.", { status: 403 });
  }
  if (!result) return new NextResponse("Photograph not found.", { status: 404 });
  return new NextResponse(new Uint8Array(result.bytes), {
    headers: {
      "Content-Type": result.photo.mimeType,
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
}
