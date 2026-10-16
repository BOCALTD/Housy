"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { computeMonth, decideAwardDispute, freezeRun, publishRun, saveAwardConfig, verifyRun } from "@/lib/services/awards";

const BACK = "/admin/awards";
export async function computeAction(form: FormData) {
  return act(BACK, async () => { const a = await requirePlatformAdmin(); const r = await computeMonth(a.id, str(form, "month")); return withNotice(BACK, `Calculated version ${r.version}. Check it, then publish.`); });
}
export async function publishAction(form: FormData) {
  return act(BACK, async () => { const a = await requirePlatformAdmin(); await publishRun(a.id, str(form, "id")); return withNotice(BACK, "Published."); });
}
export async function freezeAction(form: FormData) {
  return act(BACK, async () => { const a = await requirePlatformAdmin(); await freezeRun(a.id, str(form, "id")); return withNotice(BACK, "Frozen. It can no longer change."); });
}
export async function verifyAction(form: FormData) {
  return act(BACK, async () => { const a = await requirePlatformAdmin(); const v = await verifyRun(a.id, str(form, "id")); return withNotice(BACK, v.matches ? `Recomputed from the recorded facts: all ${v.checked} lines match.` : `Mismatch on ${v.diffs.length} lines.`); });
}
export async function configAction(form: FormData) {
  return act(BACK, async () => {
    const a = await requirePlatformAdmin();
    await saveAwardConfig(a.id, { wSales: str(form, "wSales") as never, wPosts: str(form, "wPosts") as never, wRating: str(form, "wRating") as never, minSales: str(form, "minSales") as never, minPosts: str(form, "minPosts") as never, minReviews: str(form, "minReviews") as never, windowDays: str(form, "windowDays") as never, completedDays: str(form, "completedDays") as never });
    return withNotice(BACK, "Saved. It applies to the next calculation.");
  });
}
export async function disputeDecisionAction(form: FormData) {
  return act(BACK, async () => { const a = await requirePlatformAdmin(); await decideAwardDispute(a.id, str(form, "id"), str(form, "decision") as "uphold", str(form, "note")); return withNotice(BACK, "Decision recorded."); });
}
