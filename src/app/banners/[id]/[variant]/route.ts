import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { bannerImage } from "@/lib/services/banners";

// A promo banner's picture (desktop or phone version). Public while the banner is showing; the platform administrator can also see
// hidden ones (for the preview on the admin page).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; variant: string }> }) {
  const { id, variant } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id) || (variant !== "desktop" && variant !== "mobile")) return new NextResponse("Not found", { status: 404 });
  const session = await getSession();
  const admin = session?.user.isPlatformAdmin ? session.userId : null;
  const img = await bannerImage(id, variant, admin).catch(() => null);
  if (!img) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(img.bytes), {
    headers: {
      "Content-Type": img.mime,
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      // The address carries the banner's version, so a changed picture is a new address.
      "Cache-Control": admin ? "private, no-store" : "public, max-age=86400",
    },
  });
}
