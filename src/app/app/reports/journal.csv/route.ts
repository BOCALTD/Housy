import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { accountingJournal, logAccountingExport } from "@/lib/services/accounting";
import { journalRows } from "@/lib/accounting-rules";
import { toCsvWithAmounts } from "@/lib/csv";

// The period's journal as a CSV for the company's accounting package, for signed-in members who can view finance.
export async function GET(req: Request) {
  const member = await getMember();
  if (!member) return new NextResponse("Sign in to download reports.", { status: 401 });
  if (!can(member.role, "finance.view")) return new NextResponse("You do not have access to financial reports.", { status: 403 });
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "", to = url.searchParams.get("to") ?? "";
  const layout = url.searchParams.get("layout") === "signed" ? "signed" : "debit-credit";
  let j;
  try { j = await accountingJournal(member, from, to); }
  catch (err) { return new NextResponse(err instanceof Error ? err.message : "Could not build the journal.", { status: 400 }); }
  if (j.unbalanced.length) return new NextResponse(`Some entries do not balance (${j.unbalanced.slice(0, 5).join(", ")}). Nothing was exported; report this to support.`, { status: 500 });
  const { header, rows } = journalRows(j, j.codes, layout);
  await logAccountingExport(member, from, to, j.entries.length);
  return new NextResponse(toCsvWithAmounts(header, rows, ["Amount", "Debit", "Credit"]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="journal-${from}-to-${to}${layout === "signed" ? "-signed" : ""}.csv"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
