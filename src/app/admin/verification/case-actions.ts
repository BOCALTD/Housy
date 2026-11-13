"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import {
  assignCase, cancelByAdmin, decideIntake, platformDecision, releaseReport, resolveDispute, revokeReport, startPlatformReview, withdrawOffer,
} from "@/lib/services/verification-cases";

const casePage = (ref: string) => `/admin/verification/cases/${encodeURIComponent(ref)}`;
function run(form: FormData, fn: (adminId: string, ref: string) => Promise<unknown>, done: string) {
  const ref = str(form, "ref");
  return act(casePage(ref), async () => { const a = await requirePlatformAdmin(); await fn(a.id, ref); return withNotice(casePage(ref), done); });
}

export async function intakeAction(form: FormData) {
  const to = str(form, "to") as "READY_FOR_ASSIGNMENT" | "PENDING_PAYMENT" | "REJECTED";
  return run(form, (a, ref) => decideIntake(a, ref, to, str(form, "note")), to === "REJECTED" ? "Request declined. The customer has been told why." : to === "PENDING_PAYMENT" ? "Waiting for payment. The customer has been told." : "Confirmed. Offer it to a provider below.");
}
export async function assignAction(form: FormData) {
  return run(form, (a, ref) => assignCase(a, ref, { providerId: str(form, "providerId"), method: (str(form, "method") || "MANUAL") as never, reason: str(form, "reason"), requiredBy: str(form, "requiredBy") || undefined }), "Offered. The provider has 48 hours to accept or decline.");
}
export async function withdrawOfferAction(form: FormData) { return run(form, (a, ref) => withdrawOffer(a, ref, str(form, "reason")), "Offer withdrawn. Offer the case to another provider."); }
export async function cancelCaseAdminAction(form: FormData) { return run(form, (a, ref) => cancelByAdmin(a, ref, str(form, "reason")), "Case cancelled. The customer and provider have been told."); }
export async function startPlatformReviewAction(form: FormData) { return run(form, (a, ref) => startPlatformReview(a, ref), "Review started."); }
export async function platformDecisionAction(form: FormData) {
  const approve = str(form, "decision") === "approve";
  return run(form, (a, ref) => platformDecision(a, ref, approve, str(form, "note")), approve ? "Approved for release." : "Sent back to the provider for correction.");
}
export async function releaseAction(form: FormData) { return run(form, (a, ref) => releaseReport(a, ref), "Report released to the customer, with its fingerprint."); }
export async function revokeAction(form: FormData) { return run(form, (a, ref) => revokeReport(a, ref, str(form, "reason")), "Report revoked. The public check now shows it as withdrawn."); }
export async function disputeDecisionAction(form: FormData) {
  const reopen = str(form, "decision") === "reopen";
  return run(form, (a, ref) => resolveDispute(a, ref, reopen, str(form, "note")), reopen ? "Reopened for review. Send it back to the provider if a correction is needed." : "Dispute closed. The customer has been told.");
}
