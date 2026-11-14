"use server";

import { requireMember } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { saveAgentProfile, saveCompanyProfile } from "@/lib/services/community";
import { removeCompanyLogo, saveCompanyLogo, setLogoWatermark } from "@/lib/services/company-logo";

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

export async function logoUploadAction(form: FormData) {
  return act("/app/profile", async () => {
    const m = await requireMember("settings.manage");
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new Error("Choose a picture first.");
    await saveCompanyLogo(m, file.type, new Uint8Array(await file.arrayBuffer()));
    return withNotice("/app/profile", "Logo saved.");
  });
}

export async function logoRemoveAction() {
  return act("/app/profile", async () => {
    await removeCompanyLogo(await requireMember("settings.manage"));
    return withNotice("/app/profile", "Logo removed.");
  });
}

export async function logoWatermarkAction(form: FormData) {
  const on = str(form, "on") === "1";
  return act("/app/profile", async () => {
    await setLogoWatermark(await requireMember("settings.manage"), on);
    return withNotice("/app/profile", on ? "Your logo now shows on your property photos." : "Logo watermark turned off.");
  });
}
