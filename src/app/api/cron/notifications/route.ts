import { cronAuthorised } from "@/lib/cron-auth";
import { processOutbox } from "@/lib/services/delivery";

export const dynamic = "force-dynamic";

/** Called on a schedule by the host (a systemd timer on the server). It sends what is due and retries what failed. */
export async function GET(req: Request) {
  if (!cronAuthorised(req)) return new Response("Unauthorised", { status: 401 });
  return Response.json(await processOutbox());
}
