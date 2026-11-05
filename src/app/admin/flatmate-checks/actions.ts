"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { decideFlatmateCheck } from "@/lib/services/flatmates";

export async function decideCheckAction(form: FormData) {
  return act("/admin/flatmate-checks", async () => {
    const admin = await requirePlatformAdmin();
    const yes = str(form, "decision") === "verify";
    await decideFlatmateCheck(admin.id, str(form, "userId"), yes, str(form, "note"));
    return withNotice("/admin/flatmate-checks", yes ? "Verified. They have been told." : "Sent back with your reason.");
  });
}
