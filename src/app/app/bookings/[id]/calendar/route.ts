import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { bookingIcsForCompany } from "@/lib/services/calendar";
import { siteOrigin } from "@/lib/origin";
import { icsResponse } from "@/lib/ics-response";

export const dynamic = "force-dynamic";

// A confirmed inspection as a calendar file, for the company's staff.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = await getMember();
  if (!member || member.companySuspended || !can(member.role, "booking.manage") || !/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const r = await bookingIcsForCompany(member, id, await siteOrigin());
  if (!r) return new NextResponse("Not found", { status: 404 });
  return icsResponse(r.ics, `inspection-${r.ref}.ics`);
}
