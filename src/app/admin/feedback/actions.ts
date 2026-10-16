"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { reviewRating, saveFeedbackSettings } from "@/lib/services/feedback";

const BACK = "/admin/feedback";
export async function intervalAction(form: FormData) {
  return act(BACK, async () => { const a = await requirePlatformAdmin(); await saveFeedbackSettings(a.id, str(form, "intervalDays")); return withNotice(BACK, "Saved. People are asked this often from now on."); });
}
export async function reviewRatingAction(form: FormData) {
  return act(BACK, async () => { const a = await requirePlatformAdmin(); await reviewRating(a.id, str(form, "id"), str(form, "status"), str(form, "note")); return withNotice(BACK, "Saved."); });
}
