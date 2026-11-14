import { cronAuthorised } from "@/lib/cron-auth";
import { processOutbox } from "@/lib/services/delivery";
import { inspectionReminders } from "@/lib/services/inspection-bookings";
import { safetyHousekeeping } from "@/lib/services/safety";
import { sendMaintenanceNotice } from "@/lib/services/maintenance-mode";

export const dynamic = "force-dynamic";

/** Called on a schedule by the host (a systemd timer on the server). Inspection reminders and safety clean-up first, then it sends what is due and retries what failed. */
export async function GET(req: Request) {
  if (!cronAuthorised(req)) return new Response("Unauthorised", { status: 401 });
  const reminders = await inspectionReminders().catch((e) => ({ error: String(e) }));
  const safety = await safetyHousekeeping().catch((e) => ({ error: String(e) }));
  // Planned maintenance: everyone is told in the app and by email 24 hours before (queued here, sent just below).
  const maintenance = await sendMaintenanceNotice().catch((e) => ({ error: String(e) }));
  return Response.json({ ...(await processOutbox()), reminders, safety, maintenance });
}
