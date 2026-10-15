import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { rentReport } from "@/lib/services/reports";
import { parseDateOnly, todayInLagos, toDateOnlyString } from "@/lib/dates";
import { koboToPlain, toCsv } from "@/lib/csv";

// The property rent report as a CSV, served only to signed-in members who can view finance.
export async function GET(req: Request) {
  const member = await getMember();
  if (!member) return new NextResponse("Sign in to download reports.", { status: 401 });
  if (!can(member.role, "finance.view")) return new NextResponse("You do not have access to financial reports.", { status: 403 });
  const url = new URL(req.url);
  const today = todayInLagos();
  let from: Date, to: Date;
  try {
    from = parseDateOnly(url.searchParams.get("from") || `${today.getUTCFullYear()}-01-01`);
    to = parseDateOnly(url.searchParams.get("to") || toDateOnlyString(today));
  } catch {
    return new NextResponse("Use dates in the form YYYY-MM-DD.", { status: 400 });
  }
  let report;
  try {
    report = await rentReport(member, { from, to });
  } catch (err) {
    return new NextResponse(err instanceof Error ? err.message : "Could not build the report.", { status: 400 });
  }
  const body = toCsv(
    ["Property ref", "Property", "Active leases", "Billed (NGN)", "Collected (NGN)", "Arrears today (NGN)"],
    [
      ...report.rows.map((r) => [r.assetRef, r.assetName, r.activeLeases, koboToPlain(r.billedKobo), koboToPlain(r.collectedKobo), koboToPlain(r.arrearsKobo)]),
      ["", "Portfolio total", report.totals.activeLeases, koboToPlain(report.totals.billedKobo), koboToPlain(report.totals.collectedKobo), koboToPlain(report.totals.arrearsKobo)],
    ],
  );
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="rent-report-${toDateOnlyString(from)}-to-${toDateOnlyString(to)}.csv"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
