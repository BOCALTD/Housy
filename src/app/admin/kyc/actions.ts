"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { autoCheckKyc, decideKyc } from "@/lib/services/kyc";
import { AUTO_OUTCOME_LABEL } from "@/lib/kyc-auto-rules";

const DECISIONS = ["verify", "needs_info", "reject", "revoke", "start"] as const;

export async function decideKycAction(form: FormData) {
  return act("/admin/kyc", async () => {
    const admin = await requirePlatformAdmin();
    const decision = str(form, "decision") as (typeof DECISIONS)[number];
    if (!DECISIONS.includes(decision)) throw new Error("Choose a decision");
    const months = Number.parseInt(str(form, "months"), 10);
    await decideKyc(admin.id, str(form, "id"), { decision, note: str(form, "note"), scope: str(form, "scope"), evidence: str(form, "evidence"), limitations: str(form, "limitations"), months: Number.isFinite(months) && months > 0 && months <= 60 ? months : undefined });
    const done = { verify: "Check verified.", needs_info: "Asked for more information.", reject: "Check rejected.", revoke: "Check revoked.", start: "Marked as under review." }[decision];
    return withNotice("/admin/kyc", done);
  });
}

export async function revealKycAction(form: FormData) {
  return act("/admin/kyc", async () => {
    await requirePlatformAdmin();
    return `/admin/kyc?reveal=${encodeURIComponent(str(form, "id"))}#k-${encodeURIComponent(str(form, "id"))}`;
  });
}

/** Try the automatic check again, for example after a provider was down or its keys were added. */
export async function rerunAutoKycAction(form: FormData) {
  return act("/admin/kyc", async () => {
    await requirePlatformAdmin();
    const outcome = await autoCheckKyc(str(form, "id"));
    return withNotice("/admin/kyc", `Automatic check: ${AUTO_OUTCOME_LABEL[outcome].toLowerCase()}.`);
  });
}
