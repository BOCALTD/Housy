import { timingSafeEqual } from "node:crypto";
import { processOutbox } from "@/lib/services/delivery";

export const dynamic = "force-dynamic";

/** Called on a schedule by the host (for example a Vercel cron job). It sends what is due and retries what failed. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret ?? ""}`;
  const ok = !!secret && given.length === want.length && timingSafeEqual(Buffer.from(given), Buffer.from(want));
  if (!ok) return new Response("Unauthorised", { status: 401 });
  return Response.json(await processOutbox());
}
