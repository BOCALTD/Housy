"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import {
  addInternalNote, approveApplication, rejectApplication, requestInformation, setProviderRestrictions, setProviderSuspended, startReview,
} from "@/lib/services/verification-network";
import { headers } from "next/headers";

const appPage = (ref: string) => `/admin/verification/applications/${encodeURIComponent(ref)}`;

export async function startReviewAction(form: FormData) {
  const ref = str(form, "ref");
  return act(appPage(ref), async () => { const a = await requirePlatformAdmin(); await startReview(a.id, ref); return withNotice(appPage(ref), "Review started. The applicant has been told."); });
}
export async function requestInfoAction(form: FormData) {
  const ref = str(form, "ref");
  return act(appPage(ref), async () => { const a = await requirePlatformAdmin(); await requestInformation(a.id, ref, str(form, "message")); return withNotice(appPage(ref), "Request sent. The applicant has been told what you need."); });
}
export async function noteAction(form: FormData) {
  const ref = str(form, "ref");
  return act(appPage(ref), async () => { const a = await requirePlatformAdmin(); await addInternalNote(a.id, ref, str(form, "note")); return withNotice(appPage(ref), "Note added (seen by Housy only)."); });
}
export async function rejectAction(form: FormData) {
  const ref = str(form, "ref");
  return act(appPage(ref), async () => { const a = await requirePlatformAdmin(); await rejectApplication(a.id, ref, str(form, "reason")); return withNotice(appPage(ref), "Decision recorded. The applicant has been told, with your reason."); });
}
export async function approveAction(form: FormData) {
  const ref = str(form, "ref");
  return act(appPage(ref), async () => {
    const admin = await requirePlatformAdmin();
    if (str(form, "confirm") !== "yes") throw new Error("Confirm that you have checked the company, its documents and its credentials.");
    const link = str(form, "linkProviderId");
    const r = await approveApplication(admin.id, ref, { allowedServices: form.getAll("allowedServices").map(String), allowedStates: form.getAll("allowedStates").map(String), shortName: str(form, "shortName"), linkProviderId: link || undefined, note: str(form, "note") });
    const h = await headers();
    const base = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
    return `${appPage(ref)}?approved=1&invite=${encodeURIComponent(`${base}/verification-partners/activate/${encodeURIComponent(r.token)}`)}&notice=${encodeURIComponent(`Approved as ${r.code}. Send the activation link below to ${r.repEmail}; it is shown only now.`)}`;
  });
}

const provPage = (id: string) => `/admin/verification/providers/${encodeURIComponent(id)}`;
export async function suspendAction(form: FormData) {
  const id = str(form, "id"), on = str(form, "suspend") === "yes";
  return act(provPage(id), async () => { const a = await requirePlatformAdmin(); await setProviderSuspended(a.id, id, on, str(form, "reason")); return withNotice(provPage(id), on ? "Provider suspended. Its records are kept." : "Suspension lifted."); });
}
export async function restrictAction(form: FormData) {
  const id = str(form, "id");
  return act(provPage(id), async () => { const a = await requirePlatformAdmin(); await setProviderRestrictions(a.id, id, { allowedServices: form.getAll("allowedServices").map(String), allowedStates: form.getAll("allowedStates").map(String) }); return withNotice(provPage(id), "Approved services and states saved."); });
}
