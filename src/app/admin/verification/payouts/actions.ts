"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { cancelPayout, decideHeldEarning, markPayoutPaid, preparePayout } from "@/lib/services/verification-finance";

const PAGE = "/admin/verification/payouts";

export async function preparePayoutAction(form: FormData) {
  return act(PAGE, async () => { const a = await requirePlatformAdmin(); const ref = await preparePayout(a.id, str(form, "providerId")); return withNotice(PAGE, `Payout ${ref} prepared. Make the bank transfer, then record its reference here.`); });
}
export async function markPaidAction(form: FormData) {
  return act(PAGE, async () => { const a = await requirePlatformAdmin(); await markPayoutPaid(a.id, str(form, "ref"), { reference: str(form, "reference"), paidOn: str(form, "paidOn"), sent: str(form, "sent") }); return withNotice(PAGE, "Payout recorded as paid. The provider has been told."); });
}
export async function cancelPayoutAction(form: FormData) {
  return act(PAGE, async () => { const a = await requirePlatformAdmin(); await cancelPayout(a.id, str(form, "ref"), str(form, "reason")); return withNotice(PAGE, "Payout cancelled. Its earnings are ready to pay again."); });
}
export async function heldEarningAction(form: FormData) {
  const release = str(form, "decision") === "release";
  return act(PAGE, async () => { const a = await requirePlatformAdmin(); await decideHeldEarning(a.id, str(form, "earningId"), release, str(form, "note")); return withNotice(PAGE, release ? "Earning released." : "Earning cancelled."); });
}
