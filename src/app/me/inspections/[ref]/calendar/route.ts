import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { bookingIcsForRequester } from "@/lib/services/calendar";
import { siteOrigin } from "@/lib/origin";
import { icsResponse } from "@/lib/ics-response";

export const dynamic = "force-dynamic";

// The person's own confirmed inspection as a calendar file.
export async function GET(_req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const session = await getSession();
  if (!session) return new NextResponse("Not found", { status: 404 });
  const r = await bookingIcsForRequester(session.user.id, decodeURIComponent(ref), await siteOrigin());
  if (!r) return new NextResponse("Not found", { status: 404 });
  return icsResponse(r.ics, `inspection-${r.ref}.ics`);
}
