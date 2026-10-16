"use server";

import { requireUser } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import { appealVacancy, replyToQuestion, setReporterPrivacy, submitVacancy, withdrawVacancy, type UploadedPhoto } from "@/lib/services/vacancies";
import { rateLimit } from "@/lib/ratelimit";

export async function submitVacancyAction(form: FormData) {
  return act("/vacancies/new", async () => {
    const user = await requireUser();
    if (!(await rateLimit(`vacancy:${user.id}`, 10, 60 * 60 * 1000))) throw new Error("You are sending reports very quickly. Please wait a little.");
    const photos: UploadedPhoto[] = [];
    for (const f of form.getAll("photos")) if (f instanceof File && f.size > 0) photos.push({ name: f.name, mimeType: f.type, bytes: new Uint8Array(await f.arrayBuffer()) });
    const r = await submitVacancy(user.id, {
      propertyType: str(form, "propertyType") as "HOUSE", purpose: (str(form, "purpose") || "UNKNOWN") as "RENT", bedrooms: str(form, "bedrooms"), address: str(form, "address"), area: str(form, "area"), city: str(form, "city"), state: str(form, "state"),
      latitude: str(form, "latitude"), longitude: str(form, "longitude"), description: str(form, "description"), observedOn: str(form, "observedOn"), ownerContact: str(form, "ownerContact"),
      allowContact: optStr(form, "allowContact") === "on", showNameToOwner: optStr(form, "showNameToOwner") === "on", understood: optStr(form, "understood") === "on",
    }, photos);
    return withNotice(`/vacancies/${r.id}`, "Thank you. Your report was received.");
  });
}
export async function replyAction(form: FormData) {
  const id = str(form, "id");
  return act(`/vacancies/${id}`, async () => { const u = await requireUser(); await replyToQuestion(u.id, id, str(form, "reply")); return withNotice(`/vacancies/${id}`, "Your answer was sent."); });
}
export async function withdrawAction(form: FormData) {
  const id = str(form, "id");
  return act(`/vacancies/${id}`, async () => { const u = await requireUser(); await withdrawVacancy(u.id, id); return withNotice(`/vacancies/${id}`, "Report withdrawn."); });
}
export async function privacyAction(form: FormData) {
  const id = str(form, "id");
  return act(`/vacancies/${id}`, async () => { const u = await requireUser(); await setReporterPrivacy(u.id, id, { allowContact: optStr(form, "allowContact") === "on", showNameToOwner: optStr(form, "showNameToOwner") === "on" }); return withNotice(`/vacancies/${id}`, "Your privacy choices were saved."); });
}
export async function appealAction(form: FormData) {
  const id = str(form, "id");
  return act(`/vacancies/${id}`, async () => { const u = await requireUser(); await appealVacancy(u.id, id, str(form, "reason")); return withNotice(`/vacancies/${id}`, "Your appeal was sent. An administrator will decide."); });
}
