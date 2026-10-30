"use server";

import { getSession } from "@/lib/auth";
import { messageFor } from "@/lib/forms";
import { addComment, commentsFor, discover, recordShare, reportTarget, toggleLike, toggleSave, type Tab } from "@/lib/services/reels";
import { follow, unfollow } from "@/lib/services/community";
import { recordSignal } from "@/lib/services/signals";

/**
 * What the full-screen reels feed calls from the browser. Watching needs no account; everything that acts (like, save,
 * comment, share, follow, report) answers { signIn: true } to a visitor, and the feed then offers sign-in or sign-up.
 */
type Out<T> = ({ ok: true } & T) | { ok: false; signIn?: true; error?: string };
const who = async () => (await getSession())?.user.id ?? null;
async function run<T>(fn: (userId: string) => Promise<T>): Promise<Out<T>> {
  const id = await who();
  if (!id) return { ok: false, signIn: true };
  try { return { ok: true, ...(await fn(id)) } as Out<T>; } catch (e) { return { ok: false, error: messageFor(e) }; }
}

export async function morePage(tab: Tab, page: number) {
  const viewerId = await who();
  const f = await discover({ viewerId, tab: viewerId ? tab : "trending", page: Math.max(0, Math.min(200, Math.floor(page))) });
  return { rows: f.rows, pages: f.pages, page: f.page };
}

export async function likeReel(id: string) {
  return run(async (u) => { const r = await toggleLike(u, id); if (r.liked) await recordSignal(u, { kind: "REEL_LIKE", reelId: id }); return r; });
}
export async function saveReel(id: string) {
  return run(async (u) => { const r = await toggleSave(u, id); if (r.saved) await recordSignal(u, { kind: "REEL_SAVE", reelId: id }); return r; });
}
export async function shareReel(id: string) {
  return run(async (u) => recordShare(u, id));
}
export async function commentOn(id: string, body: string) {
  return run(async (u) => { const c = await addComment(u, id, body); return { comment: { id: c.id, authorName: c.authorName, body: c.body, createdAt: c.createdAt } }; });
}
export async function commentsPage(id: string, page: number) {
  const r = await commentsFor(id, Math.max(0, Math.floor(page)));
  // Only what is shown: never who wrote it beyond the short name.
  return { total: r.total, page: r.page, pages: r.pages, rows: r.rows.map((c) => ({ id: c.id, authorName: c.authorName, body: c.body, createdAt: c.createdAt })) };
}
export async function followAgent(authorId: string, on: boolean) {
  return run(async (u) => { if (on) await follow(u, "AGENT", authorId); else await unfollow(u, "AGENT", authorId); return { following: on }; });
}
export async function reportReel(id: string, reason: string) {
  return run(async (u) => { await reportTarget(u, "REEL", id, reason); return {}; });
}
/** A reel watched for a few seconds: shapes this person's own suggestions only. Visitors are not tracked. */
export async function watched(id: string, seconds: number) {
  const u = await who();
  if (!u || !(seconds >= 3)) return;
  await recordSignal(u, { kind: "REEL_WATCH", reelId: id }).catch(() => {});
}
