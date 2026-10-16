"use server";

import { requireUser } from "@/lib/auth";
import { safeLocalPath } from "@/lib/security";
import { act, str, withNotice } from "@/lib/forms";
import { deleteSearch, saveSearch, setSearchAlerts, unwatchListing } from "@/lib/services/alerts";

const BACK = "/me/saved";
export async function saveSearchAction(form: FormData) {
  const back = safeLocalPath(str(form, "back"), BACK);
  return act(back, async () => {
    const u = await requireUser();
    await saveSearch(u.id, { name: str(form, "name"), purpose: str(form, "purpose") as never, city: str(form, "city"), q: str(form, "q"), maxPrice: str(form, "maxPrice"), minBeds: str(form, "minBeds") });
    return withNotice(BACK, "Search saved. We will tell you when a new property matches.");
  });
}
export async function deleteSearchAction(form: FormData) {
  return act(BACK, async () => { const u = await requireUser(); await deleteSearch(u.id, str(form, "id")); return withNotice(BACK, "Search deleted."); });
}
export async function toggleAlertsAction(form: FormData) {
  return act(BACK, async () => { const u = await requireUser(); await setSearchAlerts(u.id, str(form, "id"), str(form, "on") === "1"); return withNotice(BACK, "Updated."); });
}
export async function unwatchAction(form: FormData) {
  return act(BACK, async () => { const u = await requireUser(); await unwatchListing(u.id, str(form, "ref")); return withNotice(BACK, "You stopped watching that property."); });
}
