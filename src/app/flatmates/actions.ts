"use server";

import { requireUser } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { FACTORS } from "@/lib/flatmate-rules";
import {
  acceptFlatmateRequest, addToFlatmateRoom, declineFlatmateRequest, deleteFlatmateProfile, endFlatmateMatch, hideFlatmate, leaveFlatmateRoom,
  saveFlatmateProfile, sendFlatmateRequest, setFlatmateStatus, withdrawFlatmateRequest,
} from "@/lib/services/flatmates";

export async function saveProfileAction(form: FormData) {
  return act("/flatmates/profile", async () => {
    const user = await requireUser();
    await saveFlatmateProfile(user.id, {
      displayName: str(form, "displayName"), intent: str(form, "intent"), country: str(form, "country"), city: str(form, "city"), areas: str(form, "areas"),
      budgetMin: str(form, "budgetMin"), budgetMax: str(form, "budgetMax"), moveInFrom: str(form, "moveInFrom"), stayMonths: str(form, "stayMonths"),
      ageBand: str(form, "ageBand"), agePref: (str(form, "agePref") || "ANY") as "ANY" | "SIMILAR", gender: str(form, "gender") || "UNSAID", genderPref: str(form, "genderPref") || "ANY",
      showGender: str(form, "showGender") === "on",
      answers: Object.fromEntries(FACTORS.map((f) => [f.key, str(form, `a_${f.key}`)])),
      must: form.getAll("must").map(String), occupation: str(form, "occupation"), about: str(form, "about"), roomListingRef: str(form, "roomListingRef").toUpperCase(),
      adult: str(form, "adult") === "on",
    });
    return withNotice("/flatmates/matches", "Profile saved. Here are your matches.");
  });
}

export async function statusAction(form: FormData) {
  return act("/flatmates", async () => {
    const user = await requireUser();
    const to = str(form, "to");
    if (to === "DELETE") { await deleteFlatmateProfile(user.id); return withNotice("/flatmates", "Your flatmate profile was deleted."); }
    await setFlatmateStatus(user.id, to === "PAUSED" ? "PAUSED" : "ACTIVE");
    return withNotice("/flatmates", to === "PAUSED" ? "Your profile is paused: nobody sees it until you turn it back on." : "Your profile is visible again.");
  });
}

export async function requestAction(form: FormData) {
  const to = str(form, "to");
  return act(`/flatmates/p/${encodeURIComponent(to)}`, async () => {
    const user = await requireUser();
    const r = await sendFlatmateRequest(user.id, to, str(form, "note"));
    if (r.matched && "conversationId" in r) return withNotice(`/messages/${r.conversationId}`, "It's a match! You are now in a chat room together.");
    return withNotice(`/flatmates/p/${encodeURIComponent(to)}`, "Request sent. You'll be told when they answer.");
  });
}

export async function answerAction(form: FormData) {
  return act("/flatmates/requests", async () => {
    const user = await requireUser();
    const id = str(form, "id");
    if (str(form, "decision") === "accept") {
      const r = await acceptFlatmateRequest(user.id, id);
      return withNotice(`/messages/${r.conversationId}`, "It's a match! You are now in a chat room together.");
    }
    await declineFlatmateRequest(user.id, id);
    return withNotice("/flatmates/requests", "Request declined. They are not told why.");
  });
}

export async function withdrawAction(form: FormData) {
  return act("/flatmates/requests", async () => {
    const user = await requireUser();
    await withdrawFlatmateRequest(user.id, str(form, "id"));
    return withNotice("/flatmates/requests", "Request withdrawn.");
  });
}

export async function endMatchAction(form: FormData) {
  return act("/flatmates/requests", async () => {
    const user = await requireUser();
    await endFlatmateMatch(user.id, str(form, "id"));
    return withNotice("/flatmates/requests", "Match ended. You have left the chat rooms you shared.");
  });
}

export async function hideAction(form: FormData) {
  return act("/flatmates/matches", async () => {
    const user = await requireUser();
    await hideFlatmate(user.id, str(form, "userId"));
    return withNotice("/flatmates/matches", "Hidden. You will not see them in your matches again.");
  });
}

export async function addToRoomAction(form: FormData) {
  const conv = str(form, "conversationId");
  return act(`/messages/${encodeURIComponent(conv)}`, async () => {
    const user = await requireUser();
    await addToFlatmateRoom(user.id, str(form, "roomId"), str(form, "userId"));
    return withNotice(`/messages/${encodeURIComponent(conv)}`, "Added to the chat room.");
  });
}

export async function leaveRoomAction(form: FormData) {
  const conv = str(form, "conversationId");
  return act(`/messages/${encodeURIComponent(conv)}`, async () => {
    const user = await requireUser();
    await leaveFlatmateRoom(user.id, str(form, "roomId"));
    return withNotice("/flatmates/requests", "You left the chat room.");
  });
}
