import { NextResponse } from "next/server";
import { partnerLogo } from "@/lib/services/home";

// Logos of active partners. Anyone may see them; the database returns nothing for a hidden or removed partner.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const p = await partnerLogo(id).catch(() => null);
  if (!p?.logoBytes || !p.logoMime) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(p.logoBytes), { headers: { "Content-Type": p.logoMime, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "public, max-age=600" } });
}
