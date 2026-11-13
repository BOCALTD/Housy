"use server";

import { requireUser } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import {
  acknowledgeReport, addCustomerDocument, answerInformationRequest, cancelByCustomer, disputeReport, requestVerification,
} from "@/lib/services/verification-cases";
import { fileComplaint, rateCase, withdrawComplaint } from "@/lib/services/verification-quality";

const page = (ref: string) => `/verification/cases/${encodeURIComponent(ref)}`;

export async function requestVerificationAction(form: FormData) {
  const listing = str(form, "listingRef");
  return act(`/verification/request${listing ? `?listing=${encodeURIComponent(listing)}` : ""}`, async () => {
    const user = await requireUser();
    const ref = await requestVerification(user.id, {
      listingRef: listing, propertyAddress: str(form, "propertyAddress"), state: str(form, "state"), area: str(form, "area"),
      propertyType: str(form, "propertyType") as never, services: form.getAll("services").map(String), documentsAvailable: str(form, "documentsAvailable"),
      ownerDetails: str(form, "ownerDetails"), transactionContext: str(form, "transactionContext"), notes: str(form, "notes"),
      priority: str(form, "priority") === "URGENT" ? "URGENT" : "NORMAL", preferredProviderId: str(form, "preferredProviderId") || undefined,
    });
    return withNotice(page(ref), "Request sent. Housy will confirm it and find a qualified provider.");
  });
}

export async function customerDocAction(form: FormData) {
  const ref = str(form, "ref");
  return act(page(ref), async () => {
    const user = await requireUser();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a file to add.");
    await addCustomerDocument(user.id, ref, str(form, "title"), { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
    return withNotice(page(ref), "Document added.");
  });
}

export async function answerInfoAction(form: FormData) {
  const ref = str(form, "ref");
  return act(page(ref), async () => { const user = await requireUser(); await answerInformationRequest(user.id, ref, str(form, "answer")); return withNotice(page(ref), "Answer sent to the provider."); });
}
export async function cancelCaseAction(form: FormData) {
  const ref = str(form, "ref");
  return act(page(ref), async () => { const user = await requireUser(); await cancelByCustomer(user.id, ref, str(form, "reason")); return withNotice(page(ref), "Request cancelled."); });
}
export async function acknowledgeAction(form: FormData) {
  const ref = str(form, "ref");
  return act(page(ref), async () => { const user = await requireUser(); await acknowledgeReport(user.id, ref); return withNotice(page(ref), "Thank you. The case is complete."); });
}
export async function disputeAction(form: FormData) {
  const ref = str(form, "ref");
  return act(page(ref), async () => { const user = await requireUser(); await disputeReport(user.id, ref, str(form, "reason")); return withNotice(page(ref), "Dispute sent. Housy will review the report and reply."); });
}

export async function rateAction(form: FormData) {
  const ref = str(form, "ref");
  return act(page(ref), async () => { const user = await requireUser(); await rateCase(user.id, ref, Number(str(form, "rating")), str(form, "feedback")); return withNotice(page(ref), "Thank you for rating the report."); });
}
export async function complaintAction(form: FormData) {
  const ref = str(form, "ref");
  return act(page(ref), async () => { const user = await requireUser(); const c = await fileComplaint(user.id, ref, { category: str(form, "category"), description: str(form, "description") }); return withNotice(page(ref), `Complaint ${c} sent. The provider will give its account and Housy will decide.`); });
}
export async function withdrawComplaintAction(form: FormData) {
  const ref = str(form, "ref");
  return act(page(ref), async () => { const user = await requireUser(); await withdrawComplaint(user.id, str(form, "complaint")); return withNotice(page(ref), "Complaint withdrawn."); });
}
