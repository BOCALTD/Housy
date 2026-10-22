"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { caseAction, updateCase } from "@/lib/services/trust-cases";

const path = (ref: string) => `/admin/cases/${encodeURIComponent(ref)}`;

export async function updateCaseAction(form: FormData) {
  const ref = str(form, "ref");
  return act(path(ref), async () => {
    const admin = await requirePlatformAdmin();
    await updateCase(admin.id, ref, { status: (str(form, "status") || undefined) as never, severity: (str(form, "severity") || undefined) as never, assignToId: form.has("assignToId") ? str(form, "assignToId") : undefined, note: str(form, "note"), messageToReporter: str(form, "messageToReporter") });
    return withNotice(path(ref), "Case updated.");
  });
}

export async function caseActionAction(form: FormData) {
  const ref = str(form, "ref");
  return act(path(ref), async () => {
    const admin = await requirePlatformAdmin();
    await caseAction(admin.id, ref, str(form, "action") === "TAKE_LISTING_OFFLINE" ? "TAKE_LISTING_OFFLINE" : "RECORD", str(form, "detail"));
    return withNotice(path(ref), "Action recorded.");
  });
}
