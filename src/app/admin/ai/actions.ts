"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { saveAiConfig } from "@/lib/services/ai";

export async function saveAiConfigAction(form: FormData) {
  return act("/admin/ai", async () => {
    const a = await requirePlatformAdmin();
    await saveAiConfig(a.id, { enabled: form.get("enabled") === "on", perUserPerDay: str(form, "perUserPerDay"), perCompanyPerMonth: str(form, "perCompanyPerMonth"), publicPerDay: str(form, "publicPerDay") });
    return withNotice("/admin/ai", "Assistant settings saved.");
  });
}
