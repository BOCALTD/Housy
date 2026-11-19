import { cronAuthorised } from "@/lib/cron-auth";
import { processOutbox } from "@/lib/services/delivery";
import { processBulk } from "@/lib/services/bulk-messaging";
import { purgeUndo } from "@/lib/services/undo";
import { processSms } from "@/lib/services/sms";
import { processPendingReels } from "@/lib/services/reel-media";
import { syncPayouts } from "@/lib/services/payouts";
import { sendReviewReminders } from "@/lib/services/reviews";
import { withPlatformAdmin } from "@/lib/db";
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
  const sms = await processSms().catch((e) => ({ error: String(e) }));
  // Review reminders at most once an hour (this job runs every few minutes).
  let reviewReminders: unknown = "not due";
  const due = await withPlatformAdmin("system", async (tx) => {
    const row = await tx.platformSetting.findUnique({ where: { key: "review_reminders_at" } });
    if (row && Date.now() - new Date(row.value).getTime() < 3600_000) return false;
    const claimed = row
      ? await tx.platformSetting.updateMany({ where: { key: "review_reminders_at", value: row.value }, data: { value: new Date().toISOString() } })
      : await tx.platformSetting.createMany({ data: [{ key: "review_reminders_at", value: new Date().toISOString() }], skipDuplicates: true });
    return claimed.count === 1;
  }).catch(() => false);
  if (due) reviewReminders = await sendReviewReminders().catch((e) => ({ error: String(e) }));
  const reels = await processPendingReels().catch((e) => ({ error: String(e) }));
  const payouts = await syncPayouts().catch((e) => ({ error: String(e) }));
  return Response.json({ ...outbox, reminders, safety, maintenance, bulk, undoPurged, sms, reviewReminders, reels, payouts });
}
