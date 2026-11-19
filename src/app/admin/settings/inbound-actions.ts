"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { saveInboundConfig } from "@/lib/services/inbound-email";

export async function inboundAction(form: FormData) {
  return act("/admin/settings", async () => {
    const a = await requirePlatformAdmin();
    const newSecret = str(form, "newSecret") === "1";
    await saveInboundConfig(a.id, str(form, "domain"), newSecret);
    return withNotice("/admin/settings", newSecret ? "New secret made. Update the address in your email provider." : str(form, "domain") ? "Incoming email saved." : "Incoming email switched off.");
  });
}
