ALTER TABLE "listings" ADD COLUMN "posted_by_id" TEXT;

-- CreateEnum
CREATE TYPE "AwardRunStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'FROZEN', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "AwardPlaque" AS ENUM ('GOLD', 'DIAMOND', 'SILVER');

-- CreateEnum
CREATE TYPE "CompletedKind" AS ENUM ('SOLD', 'RENTED', 'LEASED');

-- CreateEnum
CREATE TYPE "CompletedStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "award_runs" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "AwardRunStatus" NOT NULL DEFAULT 'DRAFT',
    "config" JSONB NOT NULL,
    "inputs_hash" TEXT NOT NULL,
    "computed_by_id" TEXT NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by_id" TEXT,
    "published_at" TIMESTAMP(3),
    "frozen_by_id" TEXT,
    "frozen_at" TIMESTAMP(3),
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "award_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "award_entries" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "company_name" TEXT NOT NULL DEFAULT '',
    "eligible" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "sales" INTEGER NOT NULL,
    "posts" INTEGER NOT NULL,
    "reviews" INTEGER NOT NULL,
    "avg_rating" DOUBLE PRECISION NOT NULL,
    "rating_score" DOUBLE PRECISION NOT NULL,
    "norm_sales" DOUBLE PRECISION NOT NULL,
    "norm_posts" DOUBLE PRECISION NOT NULL,
    "norm_rating" DOUBLE PRECISION NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "rank" INTEGER,
    "plaque" "AwardPlaque",
    "facts" JSONB NOT NULL,

    CONSTRAINT "award_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "award_disputes" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ReviewCaseStatus" NOT NULL DEFAULT 'OPEN',
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "award_disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "completed_displays" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "listing_id" TEXT,
    "kind" "CompletedKind" NOT NULL,
    "category" TEXT NOT NULL,
    "bedrooms" INTEGER,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL,
    "status" "CompletedStatus" NOT NULL DEFAULT 'REQUESTED',
    "authorised_by_id" TEXT NOT NULL,
    "authorisation" TEXT NOT NULL,
    "review_note" TEXT NOT NULL DEFAULT '',
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "completed_displays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "award_runs_month_version_key" ON "award_runs"("month", "version");

-- CreateIndex
CREATE INDEX "award_runs_month_status_idx" ON "award_runs"("month", "status");

-- CreateIndex
CREATE UNIQUE INDEX "award_entries_run_id_user_id_key" ON "award_entries"("run_id", "user_id");

-- CreateIndex
CREATE INDEX "award_entries_user_id_idx" ON "award_entries"("user_id");

-- CreateIndex
CREATE INDEX "award_entries_run_id_rank_idx" ON "award_entries"("run_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "award_disputes_run_id_user_id_key" ON "award_disputes"("run_id", "user_id");

-- CreateIndex
CREATE INDEX "award_disputes_status_created_at_idx" ON "award_disputes"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "completed_displays_deal_id_key" ON "completed_displays"("deal_id");

-- CreateIndex
CREATE INDEX "completed_displays_status_kind_completed_at_idx" ON "completed_displays"("status", "kind", "completed_at");

-- CreateIndex
CREATE INDEX "completed_displays_company_id_status_idx" ON "completed_displays"("company_id", "status");


ALTER TABLE "award_runs" ADD CONSTRAINT award_run_published CHECK (status NOT IN ('PUBLISHED', 'FROZEN') OR (published_at IS NOT NULL AND published_by_id IS NOT NULL));
ALTER TABLE "award_runs" ADD CONSTRAINT award_run_frozen CHECK (status <> 'FROZEN' OR (frozen_at IS NOT NULL AND frozen_by_id IS NOT NULL));
ALTER TABLE "award_runs" ADD CONSTRAINT award_run_month CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND version >= 1);
ALTER TABLE "award_entries" ADD CONSTRAINT award_entry_rank CHECK ((rank IS NULL) = (NOT eligible) AND (plaque IS NULL OR (rank IS NOT NULL AND rank <= 3)) AND score BETWEEN 0 AND 100);
ALTER TABLE "award_disputes" ADD CONSTRAINT award_dispute_decided CHECK (status = 'OPEN' OR (decided_by_id IS NOT NULL AND decided_at IS NOT NULL));
ALTER TABLE "completed_displays" ADD CONSTRAINT completed_reviewed CHECK (status IN ('REQUESTED', 'WITHDRAWN') OR (reviewed_by_id IS NOT NULL AND reviewed_at IS NOT NULL));
ALTER TABLE "completed_displays" ADD CONSTRAINT completed_authorised CHECK (char_length(btrim(authorisation)) >= 10);

-- A run and its lines are public once published; drafts and superseded runs belong to the platform team alone.
ALTER TABLE "award_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "award_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_scope ON "award_runs" FOR SELECT USING (status IN ('PUBLISHED', 'FROZEN') OR app_platform_admin());
CREATE POLICY admin_insert ON "award_runs" FOR INSERT WITH CHECK (app_platform_admin());
CREATE POLICY admin_update ON "award_runs" FOR UPDATE USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "award_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "award_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_scope ON "award_entries" FOR SELECT USING (app_platform_admin() OR user_id = app_current_user() OR EXISTS (SELECT 1 FROM award_runs r WHERE r.id = run_id AND r.status IN ('PUBLISHED', 'FROZEN')));
CREATE POLICY admin_insert ON "award_entries" FOR INSERT WITH CHECK (app_platform_admin());
CREATE POLICY admin_update ON "award_entries" FOR UPDATE USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "award_disputes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "award_disputes" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_scope ON "award_disputes" FOR SELECT USING (user_id = app_current_user() OR app_platform_admin());
CREATE POLICY admin_insert ON "award_disputes" FOR INSERT WITH CHECK (app_platform_admin());
CREATE POLICY admin_update ON "award_disputes" FOR UPDATE USING (app_platform_admin()) WITH CHECK (app_platform_admin());

-- Completed deals shown to the public: only approved lines, only general facts.
ALTER TABLE "completed_displays" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "completed_displays" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_scope ON "completed_displays" FOR SELECT USING (status = 'APPROVED' OR company_id = app_current_company() OR app_platform_admin());
CREATE POLICY admin_insert ON "completed_displays" FOR INSERT WITH CHECK (app_platform_admin());
CREATE POLICY admin_update ON "completed_displays" FOR UPDATE USING (app_platform_admin()) WITH CHECK (app_platform_admin());
