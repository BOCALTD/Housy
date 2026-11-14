import { NextResponse } from "next/server";
import { publicLogo } from "@/lib/services/company-logo";

// A business's logo, for its public profile and directory cards. Not shown while the business is suspended or paused.
export async function GET(_req: Request, { params: paramsP }: { params: Promise<{ id: string }> }) {
  const { id } = await paramsP;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const c = await publicLogo(id).catch(() => null);
  if (!c?.logoBytes || !c.logoMime || c.suspendedAt) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(c.logoBytes), {
    headers: { "Content-Type": c.logoMime, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "public, max-age=300" },
  });
}
