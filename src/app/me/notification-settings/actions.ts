"use server";

import { requireUser } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { savePrefs } from "@/lib/services/delivery";

export async function savePrefsAction(form: FormData) {
  return act("/me/notification-settings", async () => {
    const u = await requireUser();
    await savePrefs(u.id, {
      emailActivity: form.get("emailActivity") === "on", emailAlerts: form.get("emailAlerts") === "on", emailPromotional: form.get("emailPromotional") === "on",
      digest: str(form, "digest") === "DAILY" ? "DAILY" : "INSTANT", quietStart: str(form, "quietStart") as never, quietEnd: str(form, "quietEnd") as never, areas: str(form, "areas"),
    });
    return withNotice("/me/notification-settings", "Your notification settings were saved.");
  });
}
