-- Comment threads: replies and likes on reel comments and on workspace comments.
-- A reply points at the first comment of its thread (one level of replies, shown under it).

-- Reel comments
ALTER TABLE "reel_comments" ADD COLUMN "parent_id" TEXT;
CREATE INDEX "reel_comments_parent_id_created_at_idx" ON "reel_comments"("parent_id", "created_at");
-- The platform removes a comment (and its replies and likes) when the person who wrote it deletes it.
CREATE POLICY admin_delete ON "reel_comments" FOR DELETE USING (app_platform_admin());

CREATE TABLE "reel_comment_likes" (
    "id" TEXT NOT NULL,
    "comment_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reel_comment_likes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "reel_comment_likes_comment_id_user_id_key" ON "reel_comment_likes"("comment_id", "user_id");
CREATE INDEX "reel_comment_likes_user_id_idx" ON "reel_comment_likes"("user_id");
ALTER TABLE "reel_comment_likes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reel_comment_likes" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_all ON "reel_comment_likes" FOR SELECT USING (true);
CREATE POLICY admin_write ON "reel_comment_likes" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

-- Workspace (collaboration) comments: only the parties to the collaboration see or write them, as before.
ALTER TABLE "collab_comments" ADD COLUMN "parent_id" TEXT;
CREATE INDEX "collab_comments_parent_id_created_at_idx" ON "collab_comments"("parent_id", "created_at");

CREATE TABLE "collab_comment_likes" (
    "id" TEXT NOT NULL,
    "collaboration_id" TEXT NOT NULL,
    "comment_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collab_comment_likes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "collab_comment_likes_comment_id_user_id_key" ON "collab_comment_likes"("comment_id", "user_id");
CREATE INDEX "collab_comment_likes_collaboration_id_idx" ON "collab_comment_likes"("collaboration_id");
ALTER TABLE "collab_comment_likes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "collab_comment_likes" FORCE ROW LEVEL SECURITY;
CREATE POLICY party ON "collab_comment_likes" FOR ALL
  USING (EXISTS (SELECT 1 FROM collaborations c WHERE c.id = collaboration_id))
  WITH CHECK (EXISTS (SELECT 1 FROM collaborations c WHERE c.id = collaboration_id));
