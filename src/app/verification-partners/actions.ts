"use server";

import { redirect } from "next/navigation";
import { createSession, getSession, requireUser } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import {
  acceptProviderInvitation, addApplicationDocument, removeApplicationDocument, saveApplicationPart, startApplication, submitApplication, withdrawApplication,
} from "@/lib/services/verification-network";
import { APPLICATION_PARTS, type PartKey } from "@/lib/verification-network-rules";

const page = (ref: string, step?: string) => `/verification-partners/applications/${encodeURIComponent(ref)}${step ? `?step=${step}` : ""}`;

export async function startApplicationAction() {
  const session = await getSession();
  if (!session) redirect(`/join?next=${encodeURIComponent("/verification-partners/apply")}`);
  const ref = await startApplication(session.user.id);
  redirect(page(ref, "corporate"));
}

/** Rows of repeated fields (directors, licences, professionals): name[0], name[1]… */
function rows(form: FormData, prefix: string, fields: string[]) {
  const out: Record<string, string>[] = [];
  for (let i = 0; i < 30; i++) {
    const r: Record<string, string> = {};
    let any = false;
    for (const f of fields) { const v = str(form, `${prefix}.${i}.${f}`); r[f] = v; if (v) any = true; }
    if (any) out.push(r);
  }
  return out;
}

function partFrom(form: FormData, part: PartKey): unknown {
  const g = (k: string) => str(form, k);
  switch (part) {
    case "corporate": return { registeredName: g("registeredName"), tradingName: g("tradingName"), orgType: g("orgType"), cacNumber: g("cacNumber"), registrationType: g("registrationType"), yearIncorporated: g("yearIncorporated"), country: g("country"), registeredAddress: g("registeredAddress"), operationalAddresses: g("operationalAddresses"), officialEmail: g("officialEmail"), officialPhone: g("officialPhone"), website: g("website"), profile: g("profile") };
    case "ownership": return { contactName: g("contactName"), contactPosition: g("contactPosition"), repName: g("repName"), repPosition: g("repPosition"), repEmail: g("repEmail"), repPhone: g("repPhone"), directors: rows(form, "directors", ["name", "position"]), ownershipNote: g("ownershipNote") };
    case "qualifications": return { services: form.getAll("services").map(String), memberships: g("memberships"), licences: rows(form, "licences", ["body", "number", "expires"]), accreditation: g("accreditation"), certifications: g("certifications"), professionals: rows(form, "professionals", ["name", "qualification", "licenceNumber", "expires"]) };
    case "operations": return { states: form.getAll("states").map(String), locationsNote: g("locationsNote"), propertyTypes: form.getAll("propertyTypes").map(String), fieldInvestigators: g("fieldInvestigators") || "0", professionalStaff: g("professionalStaff"), monthlyCapacity: g("monthlyCapacity"), previousProjects: g("previousProjects"), references: g("references"), resources: g("resources") };
  }
}

export async function savePartAction(form: FormData) {
  const ref = str(form, "ref"), part = str(form, "part") as PartKey;
  return act(page(ref, part), async () => {
    const user = await requireUser();
    await saveApplicationPart(user.id, ref, part, partFrom(form, part));
    const i = APPLICATION_PARTS.findIndex((p) => p.key === part);
    const next = APPLICATION_PARTS[i + 1]?.key ?? "documents";
    return withNotice(page(ref, next), "Saved.");
  });
}

export async function addDocumentAction(form: FormData) {
  const ref = str(form, "ref");
  return act(page(ref, "documents"), async () => {
    const user = await requireUser();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a file to add.");
    await addApplicationDocument(user.id, ref, { kind: str(form, "kind"), title: str(form, "title"), expiresOn: str(form, "expiresOn") }, { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
    return withNotice(page(ref, "documents"), "Document added.");
  });
}

export async function removeDocumentAction(form: FormData) {
  const ref = str(form, "ref");
  return act(page(ref, "documents"), async () => {
    const user = await requireUser();
    await removeApplicationDocument(user.id, ref, str(form, "id"));
    return withNotice(page(ref, "documents"), "Document removed.");
  });
}

export async function submitApplicationAction(form: FormData) {
  const ref = str(form, "ref");
  return act(page(ref, "review"), async () => {
    const user = await requireUser();
    if (str(form, "confirm") !== "yes") throw new Error("Confirm that the information is true and that you are authorised to apply for the organisation.");
    await submitApplication(user.id, ref, str(form, "note"));
    return withNotice(page(ref), "Application sent. Housy will review it and tell you here.");
  });
}

export async function withdrawApplicationAction(form: FormData) {
  const ref = str(form, "ref");
  return act(page(ref), async () => {
    const user = await requireUser();
    await withdrawApplication(user.id, ref, str(form, "reason"));
    return withNotice(page(ref), "Application withdrawn.");
  });
}

export async function acceptProviderInviteAction(form: FormData) {
  const token = str(form, "token");
  return act(`/verification-partners/activate/${encodeURIComponent(token)}`, async () => {
    const session = await getSession();
    const pw = str(form, "password");
    if (!session && form.has("passwordConfirm") && pw !== str(form, "passwordConfirm")) throw new Error("The two passwords do not match. Type the same password in both boxes.");
    const { userId, code } = await acceptProviderInvitation(token, { existingUserId: session?.user.id, name: str(form, "name"), password: pw });
    if (!session || session.user.id !== userId) await createSession(userId, null);
    return withNotice(`/provider/${code}`, "Welcome. You have joined the organisation on Housy.");
  });
}
