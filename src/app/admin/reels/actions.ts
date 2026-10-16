"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { decideReports, moderateReel } from "@/lib/services/reels";

const BACK = "/admin/reels";
export async function moderateReelAction(form: FormData) {
  return act(BACK, async () => { const a = await requirePlatformAdmin(); await moderateReel(a.id, str(form, "id"), str(form, "action") as "publish", str(form, "note")); return withNotice(BACK, "Done."); });
}
export async function decideReportsAction(form: FormData) {
  return act(BACK, async () => { const a = await requirePlatformAdmin(); await decideReports(a.id, str(form, "kind") === "COMMENT" ? "COMMENT" : "REEL", str(form, "id"), str(form, "decision") as "uphold", str(form, "note")); return withNotice(BACK, "Reports decided."); });
}
