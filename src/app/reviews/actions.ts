"use server";

import { requireUser } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import { appealReview, reportReview, submitReview } from "@/lib/services/reviews";
import { rateLimit } from "@/lib/ratelimit";

export async function submitReviewAction(form: FormData) {
  const invite = optStr(form, "invite"), conversation = optStr(form, "conversation");
  const back = `/reviews/write?${invite ? `invite=${encodeURIComponent(invite)}` : `conversation=${encodeURIComponent(conversation ?? "")}`}`;
  return act(back, async () => {
    const u = await requireUser();
    if (!(await rateLimit(`review:${u.id}`, 6, 24 * 60 * 60 * 1000))) throw new Error("You have written several reviews today. Please come back tomorrow.");
    await submitReview(u.id, {
      token: invite, conversationId: conversation, overall: str(form, "overall") as never, communication: str(form, "communication") as never, professionalism: str(form, "professionalism") as never,
      accuracy: str(form, "accuracy") as never, responsiveness: str(form, "responsiveness") as never, serviceQuality: str(form, "serviceQuality") as never, handling: str(form, "handling") as never, body: str(form, "body"),
    });
    return withNotice("/me/reviews", "Thank you. Your review was received.");
  });
}
export async function reportReviewAction(form: FormData) {
  const back = str(form, "back") || "/";
  return act(back, async () => { const u = await requireUser(); await reportReview(u.id, str(form, "id"), str(form, "reason")); return withNotice(back, "Thank you. The review was reported to the platform team."); });
}
export async function appealReviewAction(form: FormData) {
  return act("/me/reviews", async () => { const u = await requireUser(); await appealReview(u.id, str(form, "id"), str(form, "reason")); return withNotice("/me/reviews", "Your appeal was sent."); });
}
