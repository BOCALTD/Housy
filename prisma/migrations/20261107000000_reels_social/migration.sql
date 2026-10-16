-- CreateEnum
CREATE TYPE "ReelStatus" AS ENUM ('PENDING', 'PUBLISHED', 'HIDDEN', 'REMOVED');

-- CreateEnum
CREATE TYPE "SocialReportStatus" AS ENUM ('OPEN', 'ACTIONED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "CommentStatus" AS ENUM ('VISIBLE', 'HIDDEN');

-- CreateTable
CREATE TABLE "reels" (
    "id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "listing_id" TEXT,
    "caption" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "status" "ReelStatus" NOT NULL DEFAULT 'PENDING',
    "review_note" TEXT NOT NULL DEFAULT '',
    "reviewed_by_id" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reel_media" (
    "reel_id" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,

    CONSTRAINT "reel_media_pkey" PRIMARY KEY ("reel_id")
);

-- CreateTable
CREATE TABLE "reel_likes" (
    "id" TEXT NOT NULL,
    "reel_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reel_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reel_saves" (
    "id" TEXT NOT NULL,
    "reel_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reel_saves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reel_shares" (
    "id" TEXT NOT NULL,
    "reel_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reel_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reel_comments" (
    "id" TEXT NOT NULL,
    "reel_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "author_name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "CommentStatus" NOT NULL DEFAULT 'VISIBLE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reel_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_reports" (
    "id" TEXT NOT NULL,
    "target_kind" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "reel_id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "SocialReportStatus" NOT NULL DEFAULT 'OPEN',
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reels_status_published_at_idx" ON "reels"("status", "published_at");

-- CreateIndex
CREATE INDEX "reels_author_id_status_idx" ON "reels"("author_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "reel_likes_reel_id_user_id_key" ON "reel_likes"("reel_id", "user_id");

-- CreateIndex
CREATE INDEX "reel_likes_user_id_idx" ON "reel_likes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "reel_saves_reel_id_user_id_key" ON "reel_saves"("reel_id", "user_id");

-- CreateIndex
CREATE INDEX "reel_saves_user_id_created_at_idx" ON "reel_saves"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reel_shares_reel_id_user_id_key" ON "reel_shares"("reel_id", "user_id");

-- CreateIndex
CREATE INDEX "reel_comments_reel_id_created_at_idx" ON "reel_comments"("reel_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "social_reports_target_kind_target_id_reporter_id_key" ON "social_reports"("target_kind", "target_id", "reporter_id");

-- CreateIndex
CREATE INDEX "social_reports_status_created_at_idx" ON "social_reports"("status", "created_at");


ALTER TABLE "reels" ADD CONSTRAINT reel_caption CHECK (char_length(caption) <= 300);
ALTER TABLE "reels" ADD CONSTRAINT reel_media_type CHECK (mime_type IN ('video/mp4', 'video/webm') AND size_bytes BETWEEN 1 AND 4194304);
ALTER TABLE "reels" ADD CONSTRAINT reel_published CHECK (status NOT IN ('PUBLISHED') OR (published_at IS NOT NULL AND reviewed_by_id IS NOT NULL));
ALTER TABLE "reel_comments" ADD CONSTRAINT reel_comment_body CHECK (char_length(btrim(body)) BETWEEN 1 AND 500);
ALTER TABLE "social_reports" ADD CONSTRAINT social_report_kind CHECK (target_kind IN ('REEL', 'COMMENT') AND char_length(btrim(reason)) BETWEEN 3 AND 300);
ALTER TABLE "social_reports" ADD CONSTRAINT social_report_decided CHECK (status = 'OPEN' OR (decided_by_id IS NOT NULL AND decided_at IS NOT NULL));

-- Writes go through the platform service after it has checked who is acting. What anyone may read is decided here.
ALTER TABLE "reels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reels" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_scope ON "reels" FOR SELECT USING (status = 'PUBLISHED' OR author_id = app_current_user() OR app_platform_admin());
CREATE POLICY admin_insert ON "reels" FOR INSERT WITH CHECK (app_platform_admin());
CREATE POLICY admin_update ON "reels" FOR UPDATE USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "reel_media" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reel_media" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_scope ON "reel_media" FOR SELECT USING (EXISTS (SELECT 1 FROM reels r WHERE r.id = reel_id));
CREATE POLICY admin_insert ON "reel_media" FOR INSERT WITH CHECK (app_platform_admin());

ALTER TABLE "reel_likes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reel_likes" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_all ON "reel_likes" FOR SELECT USING (true);
CREATE POLICY admin_write ON "reel_likes" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "reel_shares" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reel_shares" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_all ON "reel_shares" FOR SELECT USING (true);
CREATE POLICY admin_write ON "reel_shares" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "reel_saves" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reel_saves" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_scope ON "reel_saves" FOR SELECT USING (user_id = app_current_user() OR app_platform_admin());
CREATE POLICY admin_write ON "reel_saves" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "reel_comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reel_comments" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_scope ON "reel_comments" FOR SELECT USING (status = 'VISIBLE' OR user_id = app_current_user() OR app_platform_admin());
CREATE POLICY admin_insert ON "reel_comments" FOR INSERT WITH CHECK (app_platform_admin());
CREATE POLICY admin_update ON "reel_comments" FOR UPDATE USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "social_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_reports" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_scope ON "social_reports" FOR SELECT USING (reporter_id = app_current_user() OR app_platform_admin());
CREATE POLICY admin_insert ON "social_reports" FOR INSERT WITH CHECK (app_platform_admin());
CREATE POLICY admin_update ON "social_reports" FOR UPDATE USING (app_platform_admin()) WITH CHECK (app_platform_admin());

-- The platform can read who follows whom, so it can tell followers about a new reel.
CREATE POLICY admin_read_follows ON "follows" FOR SELECT USING (app_platform_admin());
