"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { platformResume, platformSuspend } from "@/lib/services/collab";

export async function platformSuspendAction(form: FormData) {
  return act("/admin/collaborations", async () => {
    const admin = await requirePlatformAdmin();
    await platformSuspend(admin.id, str(form, "id"), str(form, "reason"));
    return withNotice("/admin/collaborations", "Suspended.");
  });
}
export async function platformResumeAction(form: FormData) {
  return act("/admin/collaborations", async () => {
    const admin = await requirePlatformAdmin();
    await platformResume(admin.id, str(form, "id"));
    return withNotice("/admin/collaborations", "Resumed.");
  });
}
