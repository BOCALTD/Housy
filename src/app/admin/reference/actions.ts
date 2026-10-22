"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { REF_KINDS, saveReference } from "@/lib/services/reference";

export async function saveReferenceAction(form: FormData) {
  return act("/admin/reference", async () => {
    const admin = await requirePlatformAdmin();
    const kind = str(form, "kind");
    if (!(REF_KINDS as readonly string[]).includes(kind)) throw new Error("Unknown list");
    await saveReference(admin.id, { kind: kind as never, code: str(form, "code"), label: str(form, "label"), active: str(form, "active") === "yes", position: Number.parseInt(str(form, "position") || "500", 10) || 0, country: str(form, "country") });
    return withNotice(`/admin/reference#${kind}`, "Saved. Forms and filters use it within a minute.");
  });
}
