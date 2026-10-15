"use server";

import { requireMember } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import { cancelObligation, completeObligation, createObligation, recordProfessionalReview } from "@/lib/services/obligations";

const PATH = "/app/compliance";

export async function createObligationAction(form: FormData) {
  return act(PATH, async () => {
    const member = await requireMember("obligation.manage");
    await createObligation(member, {
      assetId: optStr(form, "assetId"), kind: str(form, "kind") as never, title: str(form, "title"),
      authority: str(form, "authority"), jurisdiction: str(form, "jurisdiction"), amount: optStr(form, "amount"),
      dueDate: str(form, "dueDate"), recurrenceMonths: optStr(form, "recurrenceMonths"), nextReviewOn: optStr(form, "nextReviewOn"),
      requiresProfessionalReview: form.get("requiresProfessionalReview") === "on", notes: str(form, "notes"),
    });
    return withNotice(PATH, "Obligation added to the calendar.");
  });
}

export async function completeObligationAction(form: FormData) {
  return act(PATH, async () => {
    const member = await requireMember("obligation.complete");
    const next = await completeObligation(member, str(form, "obligationId"), {
      completedOn: str(form, "completedOn"), amountPaid: optStr(form, "amountPaid"), evidence: str(form, "evidence"),
    });
    return withNotice(PATH, next ? "Marked as done. The next one is on the calendar." : "Marked as done.");
  });
}

export async function reviewObligationAction(form: FormData) {
  return act(PATH, async () => {
    const member = await requireMember("obligation.manage");
    await recordProfessionalReview(member, str(form, "obligationId"), { reviewedBy: str(form, "reviewedBy"), reviewedOn: str(form, "reviewedOn") });
    return withNotice(PATH, "Professional review recorded.");
  });
}

export async function cancelObligationAction(form: FormData) {
  return act(PATH, async () => {
    const member = await requireMember("obligation.manage");
    await cancelObligation(member, str(form, "obligationId"), str(form, "reason"));
    return withNotice(PATH, "Obligation cancelled.");
  });
}
