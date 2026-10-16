"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import { createCampaign, endCampaign, recordCustomEvent, reviewAttribution } from "@/lib/services/referrals";

const back = "/admin/referrals";
const run = (notice: string, fn: (adminId: string) => Promise<unknown>) => act(back, async () => { const a = await requirePlatformAdmin(); await fn(a.id); return withNotice(back, notice); });

export const campaignAction = async (f: FormData) => run("Campaign created. Set its reward on the rewards page.", (id) => createCampaign(id, {
  name: str(f, "name"), audience: str(f, "audience") as "SEEKER", event: str(f, "event") as "REFERRAL_REGISTERED", description: optStr(f, "description") ?? "", startsOn: str(f, "startsOn"), endsOn: optStr(f, "endsOn") ?? "",
  attributionDays: str(f, "attributionDays"), qualifyWithinDays: str(f, "qualifyWithinDays"), maxRewardsPerReferrer: optStr(f, "maxRewardsPerReferrer") ?? "",
}));
export const endCampaignAction = async (f: FormData) => run("Campaign ended.", (id) => endCampaign(id, str(f, "campaignId")));
export const reviewAction = async (f: FormData) => run("Decision recorded.", (id) => reviewAttribution(id, str(f, "attributionId"), str(f, "decision") === "clear" ? "clear" : "reject", str(f, "note")));
export const customEventAction = async (f: FormData) => run("Event recorded.", (id) => recordCustomEvent(id, str(f, "attributionId"), str(f, "note")));
