import { NextResponse } from "next/server";
import { feedByToken } from "@/lib/services/calendar";
import { rateLimit } from "@/lib/ratelimit";
import { siteOrigin } from "@/lib/origin";
import { icsResponse } from "@/lib/ics-response";

export const dynamic = "force-dynamic";

// A private calendar feed. Calendar apps cannot sign in, so the secret in the link is the key: only its hash is stored,
// it shows one person's inspections, and the person can replace or turn off the link at any time.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = decodeURIComponent(raw).replace(/\.ics$/, "");
  if (!(await rateLimit(`calfeed:${token}`, 120, 60 * 60 * 1000))) return new NextResponse("Too many requests", { status: 429 });
  const ics = await feedByToken(token, await siteOrigin());
  if (!ics) return new NextResponse("Not found", { status: 404 });
  return icsResponse(ics, "inspections.ics", false);
}
