"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser, setActiveCompany } from "@/lib/auth";
import { act, phoneFrom, str, withNotice } from "@/lib/forms";
import { clearSearchPref, saveSearchPref } from "@/lib/services/search-prefs";
import { becomeAgent, checkModeTarget, removeProfileImage, saveProfileImage, takeBreak, updateAbout, type BreakLength } from "@/lib/services/profile";

const BACK = "/me/settings";

export async function uploadProfileImageAction(form: FormData) {
  return act(BACK, async () => {
    const u = await requireUser();
    const kind = str(form, "kind") === "cover" ? "cover" : "avatar";
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new Error("Choose a picture first");
    await saveProfileImage(u.id, kind, file.type, new Uint8Array(await file.arrayBuffer()));
    revalidatePath("/", "layout");
    return withNotice(BACK, kind === "cover" ? "Cover photo updated." : "Profile photo updated.");
  });
}

export async function removeProfileImageAction(form: FormData) {
  return act(BACK, async () => {
    const u = await requireUser();
    const kind = str(form, "kind") === "cover" ? "cover" : "avatar";
    await removeProfileImage(u.id, kind);
    revalidatePath("/", "layout");
    return withNotice(BACK, kind === "cover" ? "Cover photo removed." : "Profile photo removed.");
  });
}

export async function updateAboutAction(form: FormData) {
  return act(BACK, async () => {
    const u = await requireUser();
    await updateAbout(u.id, { name: str(form, "name"), bio: str(form, "bio") });
    revalidatePath("/", "layout");
    return withNotice(BACK, "Profile saved.");
  });
}

/** Switch between using Housy as yourself and as your agent business or a company you belong to. */
export async function switchModeAction(form: FormData) {
  return act(BACK, async () => {
    const u = await requireUser();
    const target = str(form, "to");
    const companyId = await checkModeTarget(u.id, target === "personal" ? null : target);
    await setActiveCompany(companyId);
    revalidatePath("/", "layout");
    return companyId ? withNotice("/app", "Switched to your workspace.") : withNotice(BACK, "You are now using Housy as yourself.");
  });
}

export async function becomeAgentAction(form: FormData) {
  return act(BACK, async () => {
    const u = await requireUser();
    const companyId = await becomeAgent(u.id, { tradingName: str(form, "tradingName"), phone: phoneFrom(form) });
    await setActiveCompany(companyId);
    revalidatePath("/", "layout");
    return withNotice("/app/profile", "Your agent workspace is ready. Finish your public profile and verification so clients can find you.");
  });
}

export async function takeBreakAction(form: FormData) {
  return act(BACK, async () => {
    const u = await requireUser();
    if (str(form, "confirm") !== "yes") throw new Error("Tick the box to confirm the break");
    await takeBreak(u.id, str(form, "length") as BreakLength);
    (await cookies()).delete("sid");
    return withNotice("/", "Enjoy your break. Sign in whenever you are ready to come back.");
  });
}

export async function saveSearchPrefAction(form: FormData) {
  return act("/me/settings#my-search", async () => {
    const u = await requireUser();
    await saveSearchPref(u.id, { city: str(form, "city"), purpose: str(form, "purpose") as "" | "SALE" | "RENT", maxPrice: str(form, "maxPrice"), minBeds: str(form, "minBeds") });
    revalidatePath("/");
    return withNotice("/me/settings#my-search", "Saved. Your home page and reels now start from this search.");
  });
}

export async function clearSearchPrefAction() {
  return act("/me/settings#my-search", async () => {
    const u = await requireUser();
    await clearSearchPref(u.id);
    return withNotice("/me/settings#my-search", "My search cleared.");
  });
}
