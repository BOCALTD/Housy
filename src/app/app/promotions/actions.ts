"use server";

import { requireMember } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { requestPromo, withdrawPromo } from "@/lib/services/promotions";

const BACK = "/app/promotions";
export async function requestPromoAction(form: FormData) {
  return act(BACK, async () => {
    await requestPromo(await requireMember("listing.manage"), str(form, "campaignId"), str(form, "listingId"), str(form, "promoPrice"));
    return withNotice(BACK, "Request sent to the platform. You will be told when it is decided.");
  });
}
export async function withdrawPromoAction(form: FormData) {
  return act(BACK, async () => {
    await withdrawPromo(await requireMember("listing.manage"), str(form, "entryId"));
    return withNotice(BACK, "Request withdrawn.");
  });
}
