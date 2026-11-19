"use server";

import { followWithUndo, markReadWithUndo } from "@/lib/services/undo-everyday";

import { requireUser } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";

export async function markReadAction(form: FormData) {
  return act("/me/notifications", async () => {
    const user = await requireUser();
    const undo = await markReadWithUndo(user.id, str(form, "id") || null);
    return undo ? withNotice("/me/notifications", str(form, "id") ? "Marked as read." : "All marked as read.", undo) : "/me/notifications";
  });
}

export async function followAction(form: FormData) {
  const back = str(form, "back") || "/directory";
  return act(back, async () => {
    const user = await requireUser();
    const undo = await followWithUndo(user.id, str(form, "kind") as never, str(form, "targetId"), true);
    return withNotice(back, "You are now following.", undo);
  });
}

export async function unfollowAction(form: FormData) {
  const back = str(form, "back") || "/me/following";
  return act(back, async () => {
    const user = await requireUser();
    const undo = await followWithUndo(user.id, str(form, "kind") as never, str(form, "targetId"), false);
    return withNotice(back, "You stopped following.", undo);
  });
}
