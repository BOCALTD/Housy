"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { liftSignInLock } from "@/lib/services/login-guard";

export async function liftLockAction(form: FormData) {
  return act("/admin/sign-in-locks", async () => {
    const admin = await requirePlatformAdmin();
    await liftSignInLock(admin.id, str(form, "key"), str(form, "reason"));
    return withNotice("/admin/sign-in-locks", "Sign-in is open again for that account.");
  });
}
