import { getSession } from "@/lib/auth";
import { providerContext } from "@/lib/services/verification-network";
import { providerStatementCsv } from "@/lib/services/verification-finance";

export const dynamic = "force-dynamic";

/** The organisation's earnings statement as a spreadsheet file, for its owner and finance staff. */
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const session = await getSession();
  if (!session) return new Response("Not found", { status: 404 });
  const ctx = await providerContext(session.user.id, code);
  if (!ctx) return new Response("Not found", { status: 404 });
  const csv = await providerStatementCsv(ctx).catch(() => null);
  if (csv === null) return new Response("Not found", { status: 404 });
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${ctx.code}-earnings.csv"`, "Cache-Control": "private, no-store" } });
}
