"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import { liftMessagingPause, pauseMessaging, resolveReport } from "@/lib/services/messaging";

const back = "/admin/moderation";
export async function resolveReportAction(form: FormData) {
  return act(back, async () => {
    const admin = await requirePlatformAdmin();
    await resolveReport(admin.id, str(form, "reportId"), str(form, "action") === "action" ? "action" : "dismiss", str(form, "note"), optStr(form, "pause") === "on");
    return withNotice(back, "Report handled.");
  });
}
export async function pauseAction(form: FormData) {
  return act(back, async () => {
    const admin = await requirePlatformAdmin();
    await pauseMessaging(admin.id, str(form, "userId"), str(form, "reason"));
    return withNotice(back, "Messaging paused.");
  });
}
export async function liftAction(form: FormData) {
  return act(back, async () => {
    const admin = await requirePlatformAdmin();
    await liftMessagingPause(admin.id, str(form, "userId"));
    return withNotice(back, "Messaging restored.");
  });
}
