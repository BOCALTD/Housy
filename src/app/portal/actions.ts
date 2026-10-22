"use server";

import { requireUser } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { acceptPortalInvite, saveVendorProfile, submitVendorWork, updateProviderLead } from "@/lib/services/portals";
import type { LeadStatus } from "@/lib/portal-rules";

function upload(form: FormData, name: string) {
  const f = form.get(name);
  return f instanceof File && f.size > 0 ? { type: f.type, name: f.name, file: f } : null;
}
async function docOf(form: FormData) {
  const u = upload(form, "doc");
  return u ? { type: u.type, name: u.name, bytes: new Uint8Array(await u.file.arrayBuffer()) } : null;
}

export async function acceptPortalAction(form: FormData) {
  const token = str(form, "token");
  return act(`/portal/accept/${encodeURIComponent(token)}`, async () => {
    const user = await requireUser();
    const inv = await acceptPortalInvite(token, user);
    return withNotice("/portal", `You can now use the ${inv.kind === "OWNER" ? "owner" : "vendor"} portal for ${inv.companyName}.`);
  });
}

export async function vendorProfileAction(form: FormData) {
  const grantId = str(form, "grantId");
  const back = `/portal/vendor/${encodeURIComponent(grantId)}`;
  return act(back, async () => {
    const user = await requireUser();
    await saveVendorProfile(user.id, grantId, { serviceAreas: str(form, "serviceAreas"), qualifications: str(form, "qualifications"), insuranceNote: str(form, "insuranceNote") }, await docOf(form));
    return withNotice(back, "Profile saved. The company can see it.") + "#profile";
  });
}

export async function vendorSubmitAction(form: FormData) {
  const grantId = str(form, "grantId"), woId = str(form, "workOrderId");
  const back = `/portal/vendor/${encodeURIComponent(grantId)}/jobs/${encodeURIComponent(woId)}`;
  return act(back, async () => {
    const user = await requireUser();
    await submitVendorWork(user.id, grantId, woId, { kind: str(form, "kind"), amount: str(form, "amount"), note: str(form, "note") }, await docOf(form));
    return withNotice(back, "Sent. The company will review it and you will be told the outcome.");
  });
}

export async function providerLeadAction(form: FormData) {
  const providerId = str(form, "providerId");
  const back = `/portal/provider/${encodeURIComponent(providerId)}`;
  return act(back, async () => {
    const user = await requireUser();
    await updateProviderLead(user.id, providerId, str(form, "ref"), str(form, "status") as LeadStatus, str(form, "note"));
    return withNotice(back, "Request updated. The person has been told.");
  });
}
