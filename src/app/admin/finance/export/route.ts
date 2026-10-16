import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { entriesCsv } from "@/lib/services/finance";

export const dynamic = "force-dynamic";

/** The platform ledger as a spreadsheet, for the platform administrator only. */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s?.user.isPlatformAdmin) return new NextResponse("Not allowed.", { status: 403 });
  const ledger = new URL(req.url).searchParams.get("ledger") ?? undefined;
  return new NextResponse(await entriesCsv(s.user.id, ledger), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="finance-ledger${ledger ? `-${ledger.toLowerCase()}` : ""}.csv"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } });
}
