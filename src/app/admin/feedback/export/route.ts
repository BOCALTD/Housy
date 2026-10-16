import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { exportRatingsCsv } from "@/lib/services/feedback";

export const dynamic = "force-dynamic";
export async function GET() {
  const s = await getSession();
  if (!s?.user.isPlatformAdmin) return new NextResponse("Platform administrators only.", { status: 403 });
  return new NextResponse(await exportRatingsCsv(s.user.id), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="platform-ratings.csv"', "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } });
}
