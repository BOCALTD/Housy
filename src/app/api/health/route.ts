import { cronAuthorised } from "@/lib/cron-auth";
import { health, healthDetail } from "@/lib/services/health";

export const dynamic = "force-dynamic";

/** For uptime monitors. Anyone gets up/down. With the cron secret, it also reports the email backlog and stuck payments. */
export async function GET(req: Request) {
  const detailed = new URL(req.url).searchParams.get("detail") === "1" && cronAuthorised(req);
  const body = detailed ? await healthDetail() : await health();
  return Response.json(body, { status: body.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
