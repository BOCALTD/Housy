"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import { markPaymentReceived, reviewPromo, saveCampaign, savePaymentInstructions, setCampaignActive } from "@/lib/services/promotions";
import { recordOfflinePayment } from "@/lib/services/billing";
import { saveBoostPrice } from "@/lib/services/boosts";
import { formatKobo } from "@/lib/money";

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
  return act(BACK, async () => {
    const a = await requirePlatformAdmin();
    const invoiceId = str(form, "invoiceId");
    // A fee with an invoice is recorded against it, so the books show the transfer; older requests without one are confirmed directly.
    if (invoiceId && str(form, "amount")) await recordOfflinePayment(a.id, invoiceId, { amount: str(form, "amount"), reference: str(form, "reference"), note: str(form, "note") });
    else await markPaymentReceived(a.id, str(form, "entryId"), str(form, "reference"), str(form, "note"));
    return withNotice(BACK, "Bank transfer recorded. The request can now be approved.");
  });
}
export async function boostPriceAction(form: FormData) {
  return act(BACK, async () => {
    const a = await requirePlatformAdmin();
    const kobo = await saveBoostPrice(a.id, str(form, "price"));
    return withNotice(BACK, kobo > 0n ? `Boosts are on sale at ${formatKobo(kobo)} a day.` : "Boosts are no longer on sale. Boosts already paid for keep running.");
  });
}
export async function reviewPromoAction(form: FormData) {
  return act(BACK, async () => {
    const a = await requirePlatformAdmin();
    const approve = str(form, "decision") === "approve";
    await reviewPromo(a.id, str(form, "entryId"), approve ? "approve" : "reject", str(form, "note"));
    return withNotice(BACK, approve ? "Promotion approved." : "Promotion turned down.");
  });
}
