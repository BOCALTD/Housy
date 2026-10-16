import { NextResponse } from "next/server";
import { adminNeedsMfa, getSession } from "@/lib/auth";
import { withPlatformAdmin } from "@/lib/db";
import { koboToPlain, toCsv } from "@/lib/csv";
import { humanize } from "@/lib/labels";
import { toDateOnlyString } from "@/lib/dates";

export const dynamic = "force-dynamic";
/** The whole reward ledger for the administrator, one line per status change. */
export async function GET() {
  const s = await getSession();
  if (!s?.user.isPlatformAdmin || adminNeedsMfa(s.user)) return new NextResponse("Platform administrators only.", { status: 403 });
  const rows = await withPlatformAdmin(s.user.id, (tx) => tx.rewardLedgerEntry.findMany({ orderBy: { createdAt: "desc" }, take: 5000 }));
  const body = toCsv(["Date", "Reward", "From", "To", "Amount (NGN)", "By", "Note"], rows.map((l) => [toDateOnlyString(l.createdAt), l.rewardId, l.fromStatus ? humanize(l.fromStatus) : "", humanize(l.toStatus), koboToPlain(l.amountKobo), l.actorName, l.note]));
  return new NextResponse(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="reward-ledger.csv"', "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } });
}
