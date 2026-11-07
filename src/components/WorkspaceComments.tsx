"use client";

import { likeWorkspaceComment, postWorkspaceComment } from "@/app/collaborations/live-actions";
import type { ThreadComment } from "@/lib/comment-rules";
import { CommentThread } from "./CommentThread";

/** Comments in a collaboration workspace: reply and like, seen only by the people in the workspace. They stay on the record, so they cannot be deleted. */
export function WorkspaceComments({ collabId, threads, total, canWrite }: { collabId: string; threads: ThreadComment[]; total: number; canWrite: boolean }) {
  return (
    <CommentThread initial={threads} total={total} signedIn={canWrite} maxLength={2000} placeholder="Write a comment" emptyText="No comments yet."
      onSignIn={() => undefined}
      actions={{ post: (b, r) => postWorkspaceComment(collabId, b, r), like: likeWorkspaceComment }} />
  );
}
