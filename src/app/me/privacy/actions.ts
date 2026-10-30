"use server";

import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { act, str } from "@/lib/forms";
import { deleteMyAccount } from "@/lib/services/privacy";
import { clearSignals, setPersonalise } from "@/lib/services/signals";

export async function deleteAccountAction(form: FormData) {
  return act("/me/privacy", async () => {
    const u = await requireUser();
    await deleteMyAccount(u.id, String(form.get("password") ?? ""), str(form, "confirm"));
    (await cookies()).delete("sid");
    return "/?notice=" + encodeURIComponent("Your account has been deleted.");
  });
}

export async function personaliseAction(form: FormData) {
  return act("/me/privacy#suggestions", async () => {
    const u = await requireUser();
    const on = str(form, "on") === "yes";
    await setPersonalise(u.id, on);
    return `/me/privacy?notice=${encodeURIComponent(on ? "Suggestions are on again." : "Suggestions are off, and what shaped them has been deleted.")}#suggestions`;
  });
}

export async function clearSignalsAction() {
  return act("/me/privacy#suggestions", async () => {
    const u = await requireUser();
    await clearSignals(u.id);
    return `/me/privacy?notice=${encodeURIComponent("Cleared. Suggestions start again from what you do next.")}#suggestions`;
  });
}
