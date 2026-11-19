"use server";

import { deleteSearchWithUndo, searchAlertsWithUndo, unshareListingWithUndo, unwatchWithUndo } from "@/lib/services/undo-everyday";

import { requireUser } from "@/lib/auth";
import { safeLocalPath } from "@/lib/security";
import { act, str, withNotice } from "@/lib/forms";
import { saveSearch } from "@/lib/services/alerts";

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
  return act(BACK, async () => { const u = await requireUser(); const undo = await deleteSearchWithUndo(u.id, str(form, "id")); return withNotice(BACK, "Search deleted.", undo); });
}
export async function toggleAlertsAction(form: FormData) {
  return act(BACK, async () => { const u = await requireUser(); const on = str(form, "on") === "1"; const undo = await searchAlertsWithUndo(u.id, str(form, "id"), on); return withNotice(BACK, on ? "Alerts on." : "Alerts off.", undo); });
}
export async function unwatchAction(form: FormData) {
  return act(BACK, async () => { const u = await requireUser(); const undo = await unwatchWithUndo(u.id, str(form, "ref")); return withNotice(BACK, "You stopped watching that property.", undo); });
}

export async function unshareAction(form: FormData) {
  return act(BACK, async () => { const u = await requireUser(); const undo = await unshareListingWithUndo(u.id, str(form, "listingId")); return withNotice(BACK, "Share taken back.", undo); });
}
