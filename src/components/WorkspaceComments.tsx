"use client";

import { deleteWorkspaceComment, likeWorkspaceComment, postWorkspaceComment } from "@/app/collaborations/live-actions";
import type { ThreadComment } from "@/lib/comment-rules";
import { CommentThread } from "./CommentThread";

/** Comments in a collaboration workspace: reply, like and delete your own, seen only by the people in the workspace. */
export function WorkspaceComments({ collabId, threads, total, canWrite }: { collabId: string; threads: ThreadComment[]; total: number; canWrite: boolean }) {
  return (
    <CommentThread initial={threads} total={total} signedIn={canWrite} maxLength={2000} placeholder="Write a comment" emptyText="No comments yet."
      onSignIn={() => undefined}
      actions={{ post: (b, r) => postWorkspaceComment(collabId, b, r), like: likeWorkspaceComment, remove: deleteWorkspaceComment }} />
  );
}
