/**
 * Comment threads, the same everywhere people comment (reels, workspaces): a comment, the replies under it (one level,
 * oldest first so a conversation reads top to bottom), likes, and who wrote what. No database here.
 */
export type ThreadRow = { id: string; parentId: string | null; authorName: string; authorId: string; body: string; createdAt: Date | string };
export type ThreadComment = {
  id: string; parentId: string | null; authorName: string; body: string; createdAt: string;
  likes: number; liked: boolean; mine: boolean; replies: ThreadComment[];
};

/** Group flat rows into threads. Top-level comments keep the order given; replies are oldest first. */
export function buildThreads(rows: ThreadRow[], likeCounts: Map<string, number>, likedByMe: Set<string>, viewerId: string | null, order: "newest" | "oldest" = "newest"): ThreadComment[] {
  const shape = (r: ThreadRow): ThreadComment => ({
    id: r.id, parentId: r.parentId, authorName: r.authorName, body: r.body, createdAt: new Date(r.createdAt).toISOString(),
    likes: likeCounts.get(r.id) ?? 0, liked: likedByMe.has(r.id), mine: !!viewerId && r.authorId === viewerId, replies: [],
  });
  const time = (r: ThreadRow) => new Date(r.createdAt).getTime();
  const tops = rows.filter((r) => !r.parentId).sort((a, b) => (order === "newest" ? time(b) - time(a) : time(a) - time(b)));
  const byId = new Map(tops.map((r) => [r.id, shape(r)]));
  for (const r of rows.filter((r) => r.parentId).sort((a, b) => time(a) - time(b))) byId.get(r.parentId!)?.replies.push(shape(r));
  return tops.map((r) => byId.get(r.id)!);
}

/** A reply always hangs off the first comment of its thread, so threads stay one level deep. */
export function threadRoot(parent: { id: string; parentId: string | null }): string {
  return parent.parentId ?? parent.id;
}

/** Replying to a reply names the person, so it is clear who is being answered ("@Ada …"), unless the text already does. */
export function withMention(body: string, replyingTo: { authorName: string; isReply: boolean }): string {
  const name = replyingTo.authorName.trim().split(/\s+/)[0];
  if (!replyingTo.isReply || !name) return body;
  return body.trimStart().toLowerCase().startsWith(`@${name.toLowerCase()}`) ? body : `@${name} ${body.trimStart()}`;
}
