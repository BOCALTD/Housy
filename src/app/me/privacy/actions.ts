"use server";

import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { act, str } from "@/lib/forms";
import { deleteMyAccount } from "@/lib/services/privacy";

export async function deleteAccountAction(form: FormData) {
  return act("/me/privacy", async () => {
    const u = await requireUser();
    await deleteMyAccount(u.id, String(form.get("password") ?? ""), str(form, "confirm"));
    (await cookies()).delete("sid");
    return "/?notice=" + encodeURIComponent("Your account has been deleted.");
  });
}
