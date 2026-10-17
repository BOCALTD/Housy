import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { ownListingPhotoBytes } from "@/lib/services/listing-photos";

// The company's own listing pictures, including those of drafts that are not public yet.
export async function GET(_req: Request, { params: paramsP }: { params: Promise<{ id: string }> }) {
  const params = await paramsP;
  const member = await getMember();
  if (!member) return new NextResponse("Sign in to view photographs.", { status: 401 });
  if (!/^[0-9a-f-]{36}$/.test(params.id)) return new NextResponse("Not found", { status: 404 });
  const photo = await ownListingPhotoBytes(member, params.id).catch(() => null);
  if (!photo) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(photo.bytes), {
    headers: { "Content-Type": photo.mimeType, "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "private, no-store" },
  });
}
