"use server";

import { requireMember } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { disputeReview, issueInvite, respondToReview, revokeInvite } from "@/lib/services/reviews";

const BACK = "/app/reviews";
export async function respondAction(form: FormData) {
  return act(BACK, async () => { await respondToReview(await requireMember("crm.manage"), str(form, "id"), str(form, "reply")); return withNotice(BACK, "Your reply is public beside the review."); });
}
export async function disputeAction(form: FormData) {
  return act(BACK, async () => { await disputeReview(await requireMember("crm.manage"), str(form, "id"), str(form, "reason")); return withNotice(BACK, "Dispute sent to the platform team."); });
}
export async function inviteAction(form: FormData) {
  return act(BACK, async () => {
    const r = await issueInvite(await requireMember("crm.manage"), { basis: str(form, "basis") as "TRANSACTION", basisRef: str(form, "basisRef"), aboutCompany: str(form, "aboutCompany") === "on" });
    return withNotice(BACK, `Give the client this link (shown once, works once): ${r.path}`);
  });
}
export async function revokeInviteAction(form: FormData) {
  return act(BACK, async () => { await revokeInvite(await requireMember("crm.manage"), str(form, "basis") as "TRANSACTION", str(form, "basisRef")); return withNotice(BACK, "Link cancelled."); });
}
