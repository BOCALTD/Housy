"use server";

import { requireMember } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { saveAgentProfile, saveCompanyProfile } from "@/lib/services/community";

export async function agentProfileAction(form: FormData) {
  return act("/app/profile", async () => {
    await saveAgentProfile(await requireMember("crm.view"), {
      displayName: str(form, "displayName"), headline: str(form, "headline"), bio: str(form, "bio"),
      listed: str(form, "listed") === "on", acceptsMessages: str(form, "acceptsMessages") === "on",
    });
    return withNotice("/app/profile", "Your public profile is saved.");
  });
}

export async function companyProfileAction(form: FormData) {
  return act("/app/profile", async () => {
    await saveCompanyProfile(await requireMember("settings.manage"), {
      kind: str(form, "kind") as never, displayName: str(form, "displayName"), tagline: str(form, "tagline"), about: str(form, "about"), listed: str(form, "listed") === "on",
    });
    return withNotice("/app/profile", "The company profile is saved.");
  });
}
