"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { decideComplaint, fileComplaintByHousy } from "@/lib/services/verification-quality";

const PAGE = "/admin/verification/quality";

export async function decideComplaintAction(form: FormData) {
  const to = (["INVESTIGATING", "UPHELD", "NOT_UPHELD"].includes(str(form, "to")) ? str(form, "to") : "INVESTIGATING") as "INVESTIGATING" | "UPHELD" | "NOT_UPHELD";
  return act(PAGE, async () => { const a = await requirePlatformAdmin(); await decideComplaint(a.id, str(form, "ref"), to, str(form, "note")); return withNotice(PAGE, to === "INVESTIGATING" ? "Marked as being looked into." : "Decision recorded. Both sides have been told."); });
}
export async function housyComplaintAction(form: FormData) {
  return act(PAGE, async () => { const a = await requirePlatformAdmin(); const ref = await fileComplaintByHousy(a.id, str(form, "providerId"), str(form, "caseRef"), { category: str(form, "category"), description: str(form, "description") }); return withNotice(PAGE, `Complaint ${ref} opened. The provider has been asked for its account.`); });
}
