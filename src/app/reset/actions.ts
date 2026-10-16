"use server";

import { act, str } from "@/lib/forms";
import { resetPassword } from "@/lib/services/account";

export async function resetAction(form: FormData) {
  const t = str(form, "t");
  return act(`/reset?t=${encodeURIComponent(t)}`, async () => {
    await resetPassword(t, str(form, "password"));
    return "/login?notice=" + encodeURIComponent("Your password was changed. Sign in with the new one.");
  });
}
