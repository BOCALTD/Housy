"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { commentOn, commentsPage, likeComment, removeComment, reportComment } from "@/app/reels/live-actions";
import type { ThreadComment } from "@/lib/comment-rules";
import { CommentThread } from "./CommentThread";

/** The comments on a reel's own page: the same thread as in the feed (like, reply, delete, report). */
export function ReelComments({ reelId, initial, total, pages, signedIn }: { reelId: string; initial: ThreadComment[]; total: number; pages: number; signedIn: boolean }) {
  const router = useRouter();
  const [page, setPage] = useState(0);
  const [count, setCount] = useState(total);
  return (
    <section className="card stack" aria-labelledby="reel-comments-h">
      <h2 id="reel-comments-h">Comments ({count})</h2>
      <CommentThread initial={initial} total={total} signedIn={signedIn} onSignIn={() => router.push(`/login?next=${encodeURIComponent(`/reels/${reelId}`)}`)}
        actions={{ post: (b, r) => commentOn(reelId, b, r), like: likeComment, remove: removeComment, report: reportComment }}
        hasMore={page + 1 < pages} onMore={async () => { const c = await commentsPage(reelId, page + 1); setPage(c.page); return c.rows; }}
        onCount={(d) => setCount((n) => Math.max(0, n + d))} rules="Be kind and stay on topic. Links are not allowed." />
    </section>
  );
}
