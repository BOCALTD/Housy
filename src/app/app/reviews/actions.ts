"use server";

import { requireMember } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { disputeReview, issueInvite, respondToReview, revokeInvite, sendInviteToClient } from "@/lib/services/reviews";

const BACK = "/app/reviews";
export async function respondAction(form: FormData) {
  return act(BACK, async () => { await respondToReview(await requireMember("crm.manage"), str(form, "id"), str(form, "reply")); return withNotice(BACK, "Your reply is public beside the review."); });
}
export async function disputeAction(form: FormData) {
  return act(BACK, async () => { await disputeReview(await requireMember("crm.manage"), str(form, "id"), str(form, "reason")); return withNotice(BACK, "Dispute sent to the platform team."); });
}
export async function inviteAction(form: FormData) {
  return act(BACK, async () => {
    const m = await requireMember("crm.manage");
    const basis = str(form, "basis") as "TRANSACTION" | "INSPECTION", basisRef = str(form, "basisRef");
    const r = await issueInvite(m, { basis, basisRef, aboutCompany: str(form, "aboutCompany") === "on" });
    const email = form.get("byEmail") === "on", sms = form.get("bySms") === "on";
    if (email || sms) {
      try {
        const via = await sendInviteToClient(m, { basis, basisRef, token: r.token, email, sms });
        return withNotice(BACK, `Review link sent to the client by ${via!.join(" and ")}. One reminder follows in three days if it is not used.`);
      } catch (e) {
        // The link exists either way: show it, with why it could not be sent.
        return `${BACK}?warning=${encodeURIComponent(`${e instanceof Error ? e.message : "It could not be sent."} The link (shown once, works once): ${r.path}`)}`;
      }
    }
    return withNotice(BACK, `Give the client this link (shown once, works once): ${r.path}`);
  });
}
export async function revokeInviteAction(form: FormData) {
  return act(BACK, async () => { await revokeInvite(await requireMember("crm.manage"), str(form, "basis") as "TRANSACTION", str(form, "basisRef")); return withNotice(BACK, "Link cancelled."); });
}
