"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import { markPaymentReceived, reviewPromo, saveCampaign, savePaymentInstructions, setCampaignActive } from "@/lib/services/promotions";

const BACK = "/admin/promotions";
export async function saveCampaignAction(form: FormData) {
  return act(BACK, async () => {
    const a = await requirePlatformAdmin();
    await saveCampaign(a.id, optStr(form, "id") ?? null, {
      name: str(form, "name"), tagline: str(form, "tagline"), theme: str(form, "theme") as never, startsOn: str(form, "startsOn"), endsOn: str(form, "endsOn"), fee: str(form, "fee"), maxDiscountPct: str(form, "maxDiscountPct") as never,
    });
    return withNotice(BACK, "Campaign saved.");
  });
}
export async function campaignActiveAction(form: FormData) {
  return act(BACK, async () => { const a = await requirePlatformAdmin(); await setCampaignActive(a.id, str(form, "id"), str(form, "active") === "yes"); return withNotice(BACK, "Campaign updated."); });
}
export async function instructionsAction(form: FormData) {
  return act(BACK, async () => { const a = await requirePlatformAdmin(); await savePaymentInstructions(a.id, str(form, "instructions")); return withNotice(BACK, "Payment instructions saved."); });
}
export async function paymentAction(form: FormData) {
  return act(BACK, async () => { const a = await requirePlatformAdmin(); await markPaymentReceived(a.id, str(form, "entryId"), str(form, "reference"), str(form, "note")); return withNotice(BACK, "Payment confirmed."); });
}
export async function reviewPromoAction(form: FormData) {
  return act(BACK, async () => {
    const a = await requirePlatformAdmin();
    const approve = str(form, "decision") === "approve";
    await reviewPromo(a.id, str(form, "entryId"), approve ? "approve" : "reject", str(form, "note"));
    return withNotice(BACK, approve ? "Promotion approved." : "Promotion turned down.");
  });
}
