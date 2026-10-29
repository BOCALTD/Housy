"use server";

import { act, str } from "@/lib/forms";
import { resetPassword } from "@/lib/services/account";

export async function resetAction(form: FormData) {
  const t = str(form, "t");
  return act(`/reset?t=${encodeURIComponent(t)}`, async () => {
    if (form.has("passwordConfirm") && str(form, "password") !== str(form, "passwordConfirm")) throw new Error("The two passwords do not match. Type the same password in both boxes.");
    await resetPassword(t, str(form, "password"));
    return "/login?notice=" + encodeURIComponent("Your password was changed. Sign in with the new one.");
  });
}
