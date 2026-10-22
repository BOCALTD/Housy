import { cronAuthorised } from "@/lib/cron-auth";
import { processPushQueue } from "@/lib/services/push";

export const dynamic = "force-dynamic";

/** Called every minute by the host (a systemd timer): pushes waiting notifications to people's devices. */
export async function GET(req: Request) {
  if (!cronAuthorised(req)) return new Response("Unauthorised", { status: 401 });
  return Response.json(await processPushQueue());
}
