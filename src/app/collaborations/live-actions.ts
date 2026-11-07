"use server";

import { currentActor } from "@/lib/collab-session";
import { messageFor } from "@/lib/forms";
import { addComment, toggleCollabCommentLike } from "@/lib/services/collab";

/** What the workspace comment thread calls from the browser: post or reply, like, delete your own. */
type Out<T> = ({ ok: true } & T) | { ok: false; error?: string };
async function run<T>(fn: (a: Awaited<ReturnType<typeof currentActor>>["actor"]) => Promise<T>): Promise<Out<T>> {
  try { const { actor } = await currentActor(); return { ok: true, ...(await fn(actor)) } as Out<T>; } catch (e) { return { ok: false, error: messageFor(e) }; }
}
const id64 = (v: unknown) => (typeof v === "string" ? v.slice(0, 64) : "");

export async function postWorkspaceComment(collabId: string, body: string, replyTo: string | null) {
  return run(async (a) => {
    const c = await addComment(a, id64(collabId), body, undefined, replyTo ? id64(replyTo) : null);
    return { comment: { id: c.id, parentId: c.parentId, authorName: c.authorName, body: c.body, createdAt: c.createdAt.toISOString(), likes: 0, liked: false, mine: true, replies: [] } };
  });
}
export async function likeWorkspaceComment(id: string) {
  return run(async (a) => toggleCollabCommentLike(a, id64(id)));
}
