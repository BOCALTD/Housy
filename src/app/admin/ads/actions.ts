"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { liftSuspension, reviewCampaign, saveAdConfig, suspendCampaign } from "@/lib/services/ads";

const back = (s: string) => `/admin/ads?status=${["PENDING_REVIEW", "APPROVED", "PAUSED", "SUSPENDED", "ENDED", "REJECTED"].includes(s) ? s : "PENDING_REVIEW"}`;

export async function reviewAdAction(form: FormData) {
  const to = back(str(form, "status"));
  return act(to, async () => {
    const a = await requirePlatformAdmin();
    const decision = str(form, "decision") === "approve" ? "approve" : "reject";
    await reviewCampaign(a.id, str(form, "id"), decision, str(form, "note"));
    return withNotice(to, decision === "approve" ? "Approved. An invoice for the budget was raised; the campaign starts once it is paid." : "Not approved. The advertiser was told why.");
  });
}
export async function suspendAdAction(form: FormData) {
  const to = back(str(form, "status"));
  return act(to, async () => { const a = await requirePlatformAdmin(); await suspendCampaign(a.id, str(form, "id"), str(form, "reason")); return withNotice(to, "Suspended. The advertiser was told why."); });
}
export async function liftAdAction(form: FormData) {
  const to = back(str(form, "status"));
  return act(to, async () => { const a = await requirePlatformAdmin(); await liftSuspension(a.id, str(form, "id")); return withNotice(to, "Suspension lifted."); });
}
export async function adConfigAction(form: FormData) {
  return act(back(""), async () => {
    const a = await requirePlatformAdmin();
    await saveAdConfig(a.id, { homeCpc: str(form, "homeCpc"), searchCpc: str(form, "searchCpc"), minBudget: str(form, "minBudget"), maxBudget: str(form, "maxBudget"), maxDays: str(form, "maxDays") });
    return withNotice(back(""), "Advertising prices saved. They apply to campaigns made from now on.");
  });
}
