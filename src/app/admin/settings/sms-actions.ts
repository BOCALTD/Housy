"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { saveSmsConfig, SMS_PROVIDERS, type SmsProvider } from "@/lib/services/sms";

export async function smsAction(form: FormData) {
  return act("/admin/settings", async () => {
    const a = await requirePlatformAdmin();
    const p = str(form, "provider");
    const provider = ((SMS_PROVIDERS as readonly string[]).includes(p) ? p : "none") as SmsProvider;
    await saveSmsConfig(a.id, {
      provider, termiiKey: str(form, "termiiKey"), termiiSender: str(form, "termiiSender"),
      twilioSid: str(form, "twilioSid"), twilioToken: str(form, "twilioToken"), twilioFrom: str(form, "twilioFrom"),
    });
    return withNotice("/admin/settings", provider === "none" ? "Text messages switched off." : "Text message provider saved.");
  });
}
