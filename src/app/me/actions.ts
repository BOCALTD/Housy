"use server";

import { requireUser } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { markRead } from "@/lib/services/notifications";
import { follow, unfollow } from "@/lib/services/community";

export async function markReadAction(form: FormData) {
  return act("/me/notifications", async () => {
    const user = await requireUser();
    await markRead(user.id, str(form, "id") || null);
    return "/me/notifications";
  });
}

export async function followAction(form: FormData) {
  const back = str(form, "back") || "/directory";
  return act(back, async () => {
    const user = await requireUser();
    await follow(user.id, str(form, "kind") as never, str(form, "targetId"));
    return withNotice(back, "You are now following.");
  });
}

export async function unfollowAction(form: FormData) {
  const back = str(form, "back") || "/me/following";
  return act(back, async () => {
    const user = await requireUser();
    await unfollow(user.id, str(form, "kind") as never, str(form, "targetId"));
    return withNotice(back, "You stopped following.");
  });
}
