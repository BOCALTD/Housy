"use server";

import { requireUser } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { applyAsArtisan } from "@/lib/services/artisans";
import { submitFlatmateCheck } from "@/lib/services/flatmates";

export async function applyArtisanAction(form: FormData) {
  return act("/artisans#register", async () => {
    const u = await requireUser();
    await applyAsArtisan(u.id, {
      companyId: str(form, "companyId"), name: str(form, "name"), phone: str(form, "phone"),
      trades: form.getAll("trades").map(String), areas: str(form, "areas"), years: str(form, "years"), bio: str(form, "bio"),
    });
    return withNotice("/artisans#mine", "Registration sent. The company will reply here and by notification.");
  });
}

/** The Housy ID check (the same one flatmates use): passing it gives the "ID verified" badge everywhere. */
export async function submitArtisanIdAction(form: FormData) {
  return act("/artisans#verify", async () => {
    const u = await requireUser();
    const doc = form.get("doc"), selfie = form.get("selfie");
    if (!(doc instanceof File) || !(selfie instanceof File)) throw new Error("Add both the ID photo and the selfie");
    await submitFlatmateCheck(u.id, str(form, "idType"), { type: doc.type, bytes: new Uint8Array(await doc.arrayBuffer()) }, { type: selfie.type, bytes: new Uint8Array(await selfie.arrayBuffer()) });
    return withNotice("/artisans#verify", "Sent. A Housy reviewer will compare your ID and selfie, and you will be told the result.");
  });
}
