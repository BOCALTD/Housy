"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { snoozeFeedback, submitRating } from "@/lib/services/feedback";
import { rateLimit } from "@/lib/ratelimit";

export async function submitRatingAction(form: FormData) {
  return act("/feedback", async () => {
    const u = await requireUser();
    if (!(await rateLimit(`rating:${u.id}`, 5, 60 * 60 * 1000))) throw new Error("Please wait a little before sending another rating.");
    await submitRating(u.id, {
      overall: str(form, "overall") as never, ease: str(form, "ease") as never, trust: str(form, "trust") as never, support: str(form, "support") as never,
      suggestion: str(form, "suggestion"), anonymous: str(form, "anonymous") === "on",
    });
    return withNotice("/", "Thank you. Your rating was received.");
  });
}
export async function snoozeAction() {
  const u = await requireUser();
  await snoozeFeedback(u.id);
  redirect("/");
}
