import { NextResponse } from "next/server";
import { publicPhotoBytes } from "@/lib/services/listing-photos";

// Pictures of published listings. Anyone may see them, but only while the listing is published (enforced by the database).
export async function GET(_req: Request, { params: paramsP }: { params: Promise<{ id: string }> }) {
  const params = await paramsP;
  if (!/^[0-9a-f-]{36}$/.test(params.id)) return new NextResponse("Not found", { status: 404 });
  const photo = await publicPhotoBytes(params.id).catch(() => null);
  if (!photo) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(photo.bytes), {
    headers: {
      "Content-Type": photo.mimeType,
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "public, max-age=300",
    },
  });
}
