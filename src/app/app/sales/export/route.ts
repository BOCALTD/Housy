import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { companyReport } from "@/lib/services/sales";
import { parseDateOnly, todayInLagos, toDateOnlyString } from "@/lib/dates";
import { koboToPlain, toCsv } from "@/lib/csv";
import { humanize } from "@/lib/labels";

// Company sales reports as CSV, served only to signed-in managers.
export async function GET(req: Request) {
  const member = await getMember();
  if (!member) return new NextResponse("Sign in to download reports.", { status: 401 });
  if (!can(member.role, "crm.report")) return new NextResponse("You do not have access to company sales reports.", { status: 403 });
  const url = new URL(req.url);
  const today = todayInLagos();
  let from: Date, to: Date;
  try {
    from = parseDateOnly(url.searchParams.get("from") || `${today.getUTCFullYear()}-01-01`);
    to = parseDateOnly(url.searchParams.get("to") || toDateOnlyString(today));
  } catch {
    return new NextResponse("Use dates in the form YYYY-MM-DD.", { status: 400 });
  }
  const kind = url.searchParams.get("kind") ?? "";
  if (!["completed", "pipeline", "sources"].includes(kind)) return new NextResponse("Choose a report: completed, pipeline or sources.", { status: 400 });
  let r;
  try { r = await companyReport(member, { from, to }); } catch (err) { return new NextResponse(err instanceof Error ? err.message : "Could not build the report.", { status: 400 }); }
  let body: string;
  if (kind === "completed") {
    body = toCsv(["Deal", "Title", "Type", "Client", "Property", "Owner", "Completed on", "Agreed price (NGN)", "Commission (NGN)", "Commission status"],
      r.completed.map((d) => [d.ref, d.title, humanize(d.type), d.client, d.asset, d.owner, toDateOnlyString(d.completedAt), koboToPlain(d.agreedKobo), d.commissionKobo === null ? "" : koboToPlain(d.commissionKobo), d.commissionStatus ? humanize(d.commissionStatus) : ""]));
  } else if (kind === "pipeline") {
    body = toCsv(["Stage", "Deals", "Disputed", "Value (NGN)"], r.pipeline.map((p) => [humanize(p.stage), p.count, p.disputed, koboToPlain(p.valueKobo)]));
  } else {
    body = toCsv(["Source", "Leads", "Qualified", "Became deals", "Rate (%)"], r.bySource.map((s) => [s.name, s.leads, s.qualified, s.converted, (s.convertedBps / 100).toFixed(1)]));
  }
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sales-${kind}-${toDateOnlyString(from)}-to-${toDateOnlyString(to)}.csv"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
