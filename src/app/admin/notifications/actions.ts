"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { processOutbox, retryEmails } from "@/lib/services/delivery";
import { saveAlertConfig } from "@/lib/services/alerts";

const BACK = "/admin/notifications";
export async function processNowAction() {
  return act(BACK, async () => {
    await requirePlatformAdmin();
    const r = await processOutbox();
    return withNotice(BACK, r.configured ? `Sent ${r.sent}, will retry ${r.retrying}, gave up on ${r.dead}, skipped ${r.skipped}, held ${r.held + r.deferred}.` : `No email provider is connected, so nothing was sent. ${r.waiting} waiting.`);
  });
}
export async function retryAction(form: FormData) {
  return act(BACK, async () => {
    const a = await requirePlatformAdmin();
    const id = str(form, "id");
    const n = await retryEmails(a.id, id === "ALL_DEAD" ? "DEAD" : id === "ALL_FAILED" ? "FAILED" : [id]);
    return withNotice(BACK, `${n} queued to try again.`);
  });
}
export async function alertConfigAction(form: FormData) {
  return act(BACK, async () => {
    const a = await requirePlatformAdmin();
    await saveAlertConfig(a.id, { maxRecipients: str(form, "maxRecipients"), savedSearches: form.get("savedSearches") === "on", followers: form.get("followers") === "on", areas: form.get("areas") === "on" });
    return withNotice(BACK, "Audience rules saved.");
  });
}
