"use server";

import { checkCaptcha } from "@/lib/captcha";
import { visitorIp } from "@/lib/request-ip";
import { act, str, withNotice } from "@/lib/forms";
import { requestPasswordReset } from "@/lib/services/account";

export async function forgotAction(form: FormData) {
  return act("/forgot", async () => {
    const ip = await visitorIp();
    await checkCaptcha(form, "reset", ip);
    await requestPasswordReset(str(form, "email"), ip);
    // The same answer whether or not the email has an account.
    return withNotice("/forgot", "If that email has an account, a link to choose a new password is on its way. It works once and expires in 1 hour.");
  });
}
