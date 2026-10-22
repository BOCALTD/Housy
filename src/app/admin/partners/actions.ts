"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { addPartner, removePartner, setPartnerActive, PARTNER_KINDS } from "@/lib/services/partners";

export async function addPartnerAction(form: FormData) {
  return act("/admin/partners", async () => {
    const admin = await requirePlatformAdmin();
    if (str(form, "confirm") !== "yes") throw new Error("Confirm that an agreement with this partner exists");
    const file = form.get("logo");
    const logo = file instanceof File && file.size > 0 ? { type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) } : null;
    await addPartner(admin.id, { name: str(form, "name"), kind: str(form, "kind") as (typeof PARTNER_KINDS)[number], url: str(form, "url"), blurb: str(form, "blurb"), position: Number.parseInt(str(form, "position") || "0", 10) || 0 }, logo);
    return withNotice("/admin/partners", "Partner added. It now shows on the home page.");
  });
}

export async function togglePartnerAction(form: FormData) {
  return act("/admin/partners", async () => {
    const admin = await requirePlatformAdmin();
    await setPartnerActive(admin.id, str(form, "id"), str(form, "active") === "yes");
    return withNotice("/admin/partners", "Saved.");
  });
}

export async function removePartnerAction(form: FormData) {
  return act("/admin/partners", async () => {
    const admin = await requirePlatformAdmin();
    await removePartner(admin.id, str(form, "id"));
    return withNotice("/admin/partners", "Partner removed.");
  });
}
