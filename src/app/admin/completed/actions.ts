"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { reviewDisplay } from "@/lib/services/completed";

const BACK = "/admin/completed";
export async function reviewDisplayAction(form: FormData) {
  return act(BACK, async () => { const a = await requirePlatformAdmin(); const ok = str(form, "decision") === "approve"; await reviewDisplay(a.id, str(form, "id"), ok ? "approve" : "reject", str(form, "note")); return withNotice(BACK, ok ? "Approved." : "Turned down."); });
}
