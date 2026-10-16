"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { decideCase, dismissReports, moderateReview, refreshAllReputation } from "@/lib/services/reviews";

const BACK = "/admin/reviews";
export async function moderateAction(form: FormData) {
  return act(BACK, async () => { const a = await requirePlatformAdmin(); await moderateReview(a.id, str(form, "id"), str(form, "action") as "hide", str(form, "note")); return withNotice(BACK, "Done."); });
}
export async function dismissAction(form: FormData) {
  return act(BACK, async () => { const a = await requirePlatformAdmin(); await dismissReports(a.id, str(form, "id"), str(form, "note")); return withNotice(BACK, "Reports dismissed."); });
}
export async function caseAction(form: FormData) {
  return act(BACK, async () => { const a = await requirePlatformAdmin(); await decideCase(a.id, str(form, "id"), str(form, "decision") as "uphold", str(form, "note")); return withNotice(BACK, "Decision recorded."); });
}
export async function recomputeAction() {
  return act(BACK, async () => { const a = await requirePlatformAdmin(); const n = await refreshAllReputation(a.id); return withNotice(BACK, `Reputation checked for ${n} profiles.`); });
}
