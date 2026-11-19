"use server";

import { requireMember } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { can } from "@/lib/permissions";
import { requestPromo, withdrawPromo } from "@/lib/services/promotions";
import { cancelBoost, requestBoost } from "@/lib/services/boosts";

const BACK = "/app/promotions";
const invoicePath = (id: string, notice: string) => `/app/billing/${encodeURIComponent(id)}?notice=${encodeURIComponent(notice)}`;

export async function requestPromoAction(form: FormData) {
  return act(BACK, async () => {
    const m = await requireMember("listing.manage");
    const r = await requestPromo(m, str(form, "campaignId"), str(form, "listingId"), str(form, "promoPrice"));
    if (r.invoiceId && can(m.role, "billing.manage")) return invoicePath(r.invoiceId, "Request sent. Pay the promotion fee here, online or by bank transfer, and the platform reviews it.");
    if (r.invoiceId) return withNotice(BACK, "Request sent. The fee invoice is on the company's billing page for your administrator to pay.");
    return withNotice(BACK, "Request sent to the platform. You will be told when it is decided.");
  });
}
export async function withdrawPromoAction(form: FormData) {
  return act(BACK, async () => {
    await withdrawPromo(await requireMember("listing.manage"), str(form, "entryId"));
    return withNotice(BACK, "Request withdrawn. Its unpaid fee invoice is cancelled.");
  });
}
export async function requestBoostAction(form: FormData) {
  return act(BACK, async () => {
    const m = await requireMember("listing.manage");
    const r = await requestBoost(m, { listingId: str(form, "listingId"), days: str(form, "days") });
    if (can(m.role, "billing.manage")) return invoicePath(r.invoice.id, "Pay this invoice to start the boost.");
    return withNotice(BACK, "Boost requested. It starts once your administrator pays the invoice on the company's billing page.");
  });
}
export async function cancelBoostAction(form: FormData) {
  return act(BACK, async () => {
    await cancelBoost(await requireMember("listing.manage"), str(form, "boostId"));
    return withNotice(BACK, "Boost cancelled. Its invoice is cancelled too.");
  });
}
