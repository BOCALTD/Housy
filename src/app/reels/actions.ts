"use server";

import { requireUser } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import { addComment, recordShare, reportTarget, toggleLike, toggleSave, uploadReel, withdrawReel } from "@/lib/services/reels";

const back = (form: FormData) => { const b = str(form, "back"); return b.startsWith("/reels") ? b : "/reels"; };

export async function likeAction(form: FormData) {
  return act(back(form), async () => { const u = await requireUser(); await toggleLike(u.id, str(form, "id")); });
}
export async function saveAction(form: FormData) {
  return act(back(form), async () => { const u = await requireUser(); const r = await toggleSave(u.id, str(form, "id")); return withNotice(back(form), r.saved ? "Saved to your reels." : "Removed from your saved reels."); });
}
export async function commentAction(form: FormData) {
  return act(back(form), async () => { const u = await requireUser(); await addComment(u.id, str(form, "id"), str(form, "body")); return withNotice(back(form), "Comment added."); });
}
export async function reportAction(form: FormData) {
  return act(back(form), async () => { const u = await requireUser(); await reportTarget(u.id, str(form, "kind") === "COMMENT" ? "COMMENT" : "REEL", str(form, "id"), str(form, "reason")); return withNotice(back(form), "Thank you. The platform team will look at it."); });
}
/** Called from the share button after the person has shared or copied the link. */
export async function shareAction(id: string) {
  const u = await requireUser();
  return (await recordShare(u.id, id)).count;
}
export async function uploadAction(form: FormData) {
  return act("/reels/new", async () => {
    const u = await requireUser();
    const f = form.get("video");
    if (!(f instanceof File) || f.size === 0) throw new Error("Choose a video");
    await uploadReel(u.id, { caption: str(form, "caption"), city: str(form, "city"), listingId: optStr(form, "listingId") }, { type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) });
    return withNotice("/reels/mine", "Your reel was sent for checking. You will be told when it is live.");
  });
}
export async function withdrawAction(form: FormData) {
  return act("/reels/mine", async () => { const u = await requireUser(); await withdrawReel(u.id, str(form, "id")); return withNotice("/reels/mine", "Reel withdrawn."); });
}
