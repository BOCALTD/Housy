"use server";

import { requireMember, requireUser } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import type { Payer } from "@/lib/services/billing";
import { createCampaign, deleteDraft, endCampaign, pauseCampaign, resumeCampaign, submitCampaign, updateCampaign, type CampaignForm } from "@/lib/services/ads";

type From = "me" | "app";
const fromOf = (form: FormData): From => (str(form, "from") === "app" ? "app" : "me");
const home = (f: From) => (f === "app" ? "/app/ads" : "/me/ads");

async function payerFor(f: From): Promise<Payer> {
  if (f === "app") { const m = await requireMember("billing.manage"); return { userId: m.userId, companyId: m.companyId, role: m.role }; }
  const u = await requireUser();
  return { userId: u.id, companyId: null, role: null };
}
const formOf = (form: FormData): CampaignForm => ({ name: str(form, "name"), listingRef: str(form, "listingRef"), placement: str(form, "placement"), headline: str(form, "headline"), startsOn: str(form, "startsOn"), endsOn: str(form, "endsOn"), budget: str(form, "budget"), dailyCap: str(form, "dailyCap") });

export async function createCampaignAction(form: FormData) {
  const f = fromOf(form);
  return act(home(f), async () => {
    const c = await createCampaign(await payerFor(f), formOf(form));
    return withNotice(`${home(f)}/${c.ref}`, "Campaign saved. Send it for review when you are ready.");
  });
}
export async function updateCampaignAction(form: FormData) {
  const f = fromOf(form), ref = str(form, "ref");
  return act(`${home(f)}/${ref}`, async () => { await updateCampaign(await payerFor(f), str(form, "id"), formOf(form)); return withNotice(`${home(f)}/${ref}`, "Campaign updated."); });
}
export async function submitCampaignAction(form: FormData) {
  const f = fromOf(form), ref = str(form, "ref");
  return act(`${home(f)}/${ref}`, async () => { await submitCampaign(await payerFor(f), str(form, "id")); return withNotice(`${home(f)}/${ref}`, "Sent for review. You will be told when it is decided."); });
}
export async function pauseCampaignAction(form: FormData) {
  const f = fromOf(form), ref = str(form, "ref");
  return act(`${home(f)}/${ref}`, async () => { await pauseCampaign(await payerFor(f), str(form, "id")); return withNotice(`${home(f)}/${ref}`, "Paused."); });
}
export async function resumeCampaignAction(form: FormData) {
  const f = fromOf(form), ref = str(form, "ref");
  return act(`${home(f)}/${ref}`, async () => { await resumeCampaign(await payerFor(f), str(form, "id")); return withNotice(`${home(f)}/${ref}`, "Resumed."); });
}
export async function endCampaignAction(form: FormData) {
  const f = fromOf(form), ref = str(form, "ref");
  return act(`${home(f)}/${ref}`, async () => { await endCampaign(await payerFor(f), str(form, "id")); return withNotice(`${home(f)}/${ref}`, "Campaign ended. Budget not spent stays yours; ask the platform to refund it."); });
}
export async function deleteCampaignAction(form: FormData) {
  const f = fromOf(form);
  return act(home(f), async () => { await deleteDraft(await payerFor(f), str(form, "id")); return withNotice(home(f), "Campaign deleted."); });
}
