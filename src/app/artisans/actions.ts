"use server";

import { requireUser } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { applyAsArtisan } from "@/lib/services/artisans";

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
