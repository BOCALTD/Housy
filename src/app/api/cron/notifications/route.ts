import { cronAuthorised } from "@/lib/cron-auth";
import { processOutbox } from "@/lib/services/delivery";
import { processBulk } from "@/lib/services/bulk-messaging";
import { purgeUndo } from "@/lib/services/undo";
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
  const outbox = await processOutbox();
  // Companies' bulk messages go after the platform's own email, so a large send never delays account email.
  const bulk = await processBulk().catch((e) => ({ error: String(e) }));
  const undoPurged = await purgeUndo().catch(() => 0);
  return Response.json({ ...outbox, reminders, safety, maintenance, bulk, undoPurged });
}
