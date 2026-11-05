"use server";

import { requireMember } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import { decideApplication, updateArtisan, updateArtisanRequest } from "@/lib/services/artisans";

const BACK = "/app/artisans";

export async function decideApplicationAction(form: FormData) {
  return act(BACK, async () => {
    const m = await requireMember("maintenance.manage");
    const yes = str(form, "decision") === "approve";
    await decideApplication(m, str(form, "id"), yes, str(form, "note"));
    return withNotice(BACK, yes ? "Approved. They are now one of your artisans and offered to your clients." : "Declined. They have been told.");
  });
}

export async function updateArtisanAction(form: FormData) {
  return act(BACK, async () => {
    const m = await requireMember("maintenance.manage");
    await updateArtisan(m, str(form, "id"), { trades: form.getAll("trades").map(String), areas: str(form, "areas"), bio: str(form, "bio"), offer: str(form, "offer") === "on" });
    return withNotice(BACK, "Artisan saved.");
  });
}

export async function updateRequestAction(form: FormData) {
  return act(BACK, async () => {
    const m = await requireMember("maintenance.manage");
    await updateArtisanRequest(m, str(form, "id"), str(form, "status"), str(form, "note"), optStr(form, "contractorId") ?? null);
    return withNotice(BACK, "Request updated. The client has been told.");
  });
}
