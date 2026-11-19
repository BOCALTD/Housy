-- Designed promo banners (with an on/off switch), likes, dislikes and shares on properties, reels and banners, and Undo for everyday actions.
-- CreateEnum
CREATE TYPE "BannerPlace" AS ENUM ('HOME', 'SEARCH', 'DASHBOARD');

-- CreateEnum
CREATE TYPE "BannerFold" AS ENUM ('BOTTOM_RIGHT', 'TOP_RIGHT', 'NONE');

-- CreateEnum
CREATE TYPE "ContentKind" AS ENUM ('LISTING', 'BANNER', 'REEL');

-- CreateEnum
CREATE TYPE "ReactionValue" AS ENUM ('LIKE', 'DISLIKE');

-- CreateTable
CREATE TABLE "promo_banners" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "link_url" TEXT NOT NULL DEFAULT '',
    "places" "BannerPlace"[],
    "fold" "BannerFold" NOT NULL DEFAULT 'BOTTOM_RIGHT',
    "float" BOOLEAN NOT NULL DEFAULT true,
    "desktop_mime" TEXT NOT NULL,
    "desktop_bytes" BYTEA NOT NULL,
    "desktop_w" INTEGER NOT NULL,
    "desktop_h" INTEGER NOT NULL,
    "mobile_mime" TEXT,
    "mobile_bytes" BYTEA,
    "mobile_w" INTEGER,
    "mobile_h" INTEGER,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_banners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_reactions" (
    "id" TEXT NOT NULL,
    "kind" "ContentKind" NOT NULL,
    "target_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "value" "ReactionValue" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_shares" (
    "id" TEXT NOT NULL,
    "kind" "ContentKind" NOT NULL,
    "target_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "undo_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "company_id" TEXT,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "undo_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "promo_banners_active_sort_order_idx" ON "promo_banners"("active", "sort_order");

-- CreateIndex
CREATE INDEX "content_reactions_kind_target_id_idx" ON "content_reactions"("kind", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "content_reactions_kind_target_id_user_id_key" ON "content_reactions"("kind", "target_id", "user_id");

-- CreateIndex
CREATE INDEX "content_shares_kind_target_id_idx" ON "content_shares"("kind", "target_id");

-- CreateIndex
CREATE INDEX "content_shares_user_id_created_at_idx" ON "content_shares"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "content_shares_kind_target_id_user_id_key" ON "content_shares"("kind", "target_id", "user_id");

-- CreateIndex
CREATE INDEX "undo_entries_user_id_created_at_idx" ON "undo_entries"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "undo_entries_expires_at_idx" ON "undo_entries"("expires_at");


ALTER TABLE "promo_banners" ADD CONSTRAINT promo_banners_values CHECK (
  char_length(title) BETWEEN 3 AND 160 AND cardinality(places) >= 1 AND desktop_w > 0 AND desktop_h > 0
  AND octet_length(desktop_bytes) BETWEEN 1 AND 8388608 AND (mobile_bytes IS NULL OR octet_length(mobile_bytes) <= 8388608)
  AND (link_url = '' OR link_url ~ '^/[^/]' OR link_url = '/' OR link_url ~ '^https://')
  AND (starts_at IS NULL OR ends_at IS NULL OR ends_at >= starts_at));

-- Banners: anyone sees the ones showing; only the platform administrator manages them.
ALTER TABLE "promo_banners" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "promo_banners" FORCE ROW LEVEL SECURITY;
CREATE POLICY public_read ON "promo_banners" FOR SELECT USING (active AND deleted_at IS NULL);
CREATE POLICY platform_admin ON "promo_banners" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

-- Reactions and shares: counts are public; each person changes only their own.
ALTER TABLE "content_reactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "content_reactions" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_all ON "content_reactions" FOR SELECT USING (true);
CREATE POLICY own_write ON "content_reactions" FOR ALL USING (user_id = app_current_user() OR app_platform_admin()) WITH CHECK (user_id = app_current_user() OR app_platform_admin());
ALTER TABLE "content_shares" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "content_shares" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_all ON "content_shares" FOR SELECT USING (true);
CREATE POLICY own_write ON "content_shares" FOR ALL USING (user_id = app_current_user() OR app_platform_admin()) WITH CHECK (user_id = app_current_user() OR app_platform_admin());

-- Undo entries belong to the person who did the action.
ALTER TABLE "undo_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "undo_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY own ON "undo_entries" FOR ALL USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
CREATE POLICY platform_admin ON "undo_entries" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
