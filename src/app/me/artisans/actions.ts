"use server";

import { requireUser } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import { dismissArtisanOffer, rateArtisanJob, requestArtisan } from "@/lib/services/artisans";

export async function requestArtisanAction(form: FormData) {
  return act("/me/artisans", async () => {
    const u = await requireUser();
    await requestArtisan(u.id, { offerId: str(form, "offerId"), trade: str(form, "trade"), contractorId: optStr(form, "contractorId"), note: str(form, "note"), address: str(form, "address"), preferredOn: str(form, "preferredOn") });
    return withNotice("/me/artisans#requests", "Request sent. The company will arrange it and let you know.");
  });
}

export async function dismissOfferAction(form: FormData) {
  return act("/me/artisans", async () => {
    const u = await requireUser();
    await dismissArtisanOffer(u.id, str(form, "offerId"));
    return "/me/artisans";
  });
}

export async function rateJobAction(form: FormData) {
  return act("/me/artisans#requests", async () => {
    const u = await requireUser();
    await rateArtisanJob(u.id, { requestId: str(form, "requestId"), stars: str(form, "stars"), body: str(form, "body") });
    return withNotice("/me/artisans#requests", "Thank you. Your rating helps other clients choose.");
  });
}
