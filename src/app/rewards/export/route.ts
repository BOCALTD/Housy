import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { koboToPlain, toCsv } from "@/lib/csv";
import { humanize } from "@/lib/labels";
import { toDateOnlyString } from "@/lib/dates";

export const dynamic = "force-dynamic";
/** The signed-in person's own rewards as CSV. */
export async function GET() {
  const s = await getSession();
  if (!s) return new NextResponse("Sign in to download your rewards.", { status: 401 });
  const rows = await withUser(s.user.id, (tx) => tx.reward.findMany({ where: { userId: s.user.id }, orderBy: { createdAt: "desc" }, take: 2000 }));
  const body = toCsv(["Reference", "Programme", "Event", "What it was for", "Amount (NGN)", "Status", "Reason", "Created", "Paid"],
    rows.map((r) => [r.ref, humanize(r.programme), humanize(r.event), r.sourceLabel, koboToPlain(r.amountKobo), humanize(r.status), r.reason, toDateOnlyString(r.createdAt), r.paidAt ? toDateOnlyString(r.paidAt) : ""]));
  return new NextResponse(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="my-rewards.csv"', "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } });
}
