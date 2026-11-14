"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { removeUserPermanently, restoreUser, suspendUser } from "@/lib/services/account-moderation";

const page = (id: string) => `/admin/people/${encodeURIComponent(id)}`;

export async function suspendUserAction(form: FormData) {
  const id = str(form, "id");
  return act(page(id), async () => { const a = await requirePlatformAdmin(); await suspendUser(a.id, id, str(form, "reason")); return withNotice(page(id), "Account suspended. They have been signed out everywhere and told why."); });
}
export async function restoreUserAction(form: FormData) {
  const id = str(form, "id");
  return act(page(id), async () => { const a = await requirePlatformAdmin(); await restoreUser(a.id, id, str(form, "reason")); return withNotice(page(id), "Account restored. They can sign in again."); });
}
export async function removeUserAction(form: FormData) {
  const id = str(form, "id");
  return act(page(id), async () => { const a = await requirePlatformAdmin(); await removeUserPermanently(a.id, id, str(form, "reason"), str(form, "confirm")); return withNotice("/admin/people?status=removed", "Account removed permanently. Its email and phone cannot be used to join again."); });
}
