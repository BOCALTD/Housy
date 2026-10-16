-- CreateEnum
CREATE TYPE "ReviewBasis" AS ENUM ('ENQUIRY', 'INSPECTION', 'TRANSACTION');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PUBLISHED', 'HELD', 'HIDDEN', 'REMOVED');

-- CreateEnum
CREATE TYPE "ReviewCaseKind" AS ENUM ('DISPUTE', 'APPEAL');

-- CreateEnum
CREATE TYPE "ReviewCaseStatus" AS ENUM ('OPEN', 'UPHELD', 'REJECTED');

-- CreateTable
CREATE TABLE "review_invites" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "agent_user_id" TEXT,
    "basis" "ReviewBasis" NOT NULL,
    "basis_ref" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "used_by_id" TEXT,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "agent_user_id" TEXT,
    "reviewer_id" TEXT NOT NULL,
    "reviewer_name" TEXT NOT NULL,
    "basis" "ReviewBasis" NOT NULL,
    "basis_ref" TEXT NOT NULL,
    "overall" INTEGER NOT NULL,
    "communication" INTEGER,
    "professionalism" INTEGER,
    "accuracy" INTEGER,
    "responsiveness" INTEGER,
    "service_quality" INTEGER,
    "handling" INTEGER,
    "body" TEXT NOT NULL DEFAULT '',
    "body_hash" TEXT NOT NULL DEFAULT '',
    "status" "ReviewStatus" NOT NULL DEFAULT 'PUBLISHED',
    "signals" TEXT NOT NULL DEFAULT '',
    "response" TEXT NOT NULL DEFAULT '',
    "responded_at" TIMESTAMP(3),
    "responded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_events" (
    "id" TEXT NOT NULL,
    "review_id" TEXT NOT NULL,
    "reviewer_id" TEXT NOT NULL,
    "actor_name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "to_reviewer" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_reports" (
    "id" TEXT NOT NULL,
    "review_id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ModerationStatus" NOT NULL DEFAULT 'OPEN',
    "handled_by_id" TEXT,
    "handled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_cases" (
    "id" TEXT NOT NULL,
    "review_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "kind" "ReviewCaseKind" NOT NULL,
    "opened_by_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ReviewCaseStatus" NOT NULL DEFAULT 'OPEN',
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reputation_snapshots" (
    "id" TEXT NOT NULL,
    "subject_kind" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "review_count" INTEGER NOT NULL,
    "average" DOUBLE PRECISION NOT NULL,
    "formula" INTEGER NOT NULL,
    "inputs" JSONB NOT NULL,
    "components" JSONB NOT NULL,
    "badges" JSONB NOT NULL,
    "inputs_hash" TEXT NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reputation_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "review_invites_token_hash_key" ON "review_invites"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "review_invites_basis_basis_ref_key" ON "review_invites"("basis", "basis_ref");

-- CreateIndex
CREATE INDEX "review_invites_company_id_created_at_idx" ON "review_invites"("company_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_ref_key" ON "reviews"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_reviewer_id_basis_basis_ref_key" ON "reviews"("reviewer_id", "basis", "basis_ref");

-- CreateIndex
CREATE INDEX "reviews_company_id_status_created_at_idx" ON "reviews"("company_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "reviews_agent_user_id_status_created_at_idx" ON "reviews"("agent_user_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "reviews_reviewer_id_idx" ON "reviews"("reviewer_id");

-- CreateIndex
CREATE INDEX "review_events_review_id_created_at_idx" ON "review_events"("review_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "review_reports_review_id_reporter_id_key" ON "review_reports"("review_id", "reporter_id");

-- CreateIndex
CREATE INDEX "review_reports_status_created_at_idx" ON "review_reports"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "review_cases_review_id_kind_key" ON "review_cases"("review_id", "kind");

-- CreateIndex
CREATE INDEX "review_cases_status_created_at_idx" ON "review_cases"("status", "created_at");

-- CreateIndex
CREATE INDEX "reputation_snapshots_subject_kind_subject_id_computed_at_idx" ON "reputation_snapshots"("subject_kind", "subject_id", "computed_at");


-- Ratings run from 1 to 5; text is bounded; a decided case names who decided it.
ALTER TABLE "reviews" ADD CONSTRAINT review_scores CHECK (
  overall BETWEEN 1 AND 5 AND (communication IS NULL OR communication BETWEEN 1 AND 5) AND (professionalism IS NULL OR professionalism BETWEEN 1 AND 5)
  AND (accuracy IS NULL OR accuracy BETWEEN 1 AND 5) AND (responsiveness IS NULL OR responsiveness BETWEEN 1 AND 5)
  AND (service_quality IS NULL OR service_quality BETWEEN 1 AND 5) AND ("handling" IS NULL OR "handling" BETWEEN 1 AND 5));
ALTER TABLE "reviews" ADD CONSTRAINT review_text CHECK (char_length(body) <= 2000 AND char_length(response) <= 1500);
ALTER TABLE "reviews" ADD CONSTRAINT review_response_by CHECK (response = '' OR (responded_by_id IS NOT NULL AND responded_at IS NOT NULL));
ALTER TABLE "review_cases" ADD CONSTRAINT review_case_decided CHECK (status = 'OPEN' OR (decided_by_id IS NOT NULL AND decided_at IS NOT NULL));
ALTER TABLE "review_invites" ADD CONSTRAINT review_invite_window CHECK (expires_at > created_at);
ALTER TABLE "reputation_snapshots" ADD CONSTRAINT reputation_score_range CHECK (score BETWEEN 0 AND 100 AND review_count >= 0);

-- Row-level security.
-- Invites: the company that made them, the platform team, and whoever holds the link (found by its hash).
ALTER TABLE "review_invites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "review_invites" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_scope ON "review_invites" FOR SELECT USING (company_id = app_current_company() OR token_hash = app_invite_token() OR app_platform_admin());
CREATE POLICY company_insert ON "review_invites" FOR INSERT WITH CHECK (company_id = app_current_company() OR app_platform_admin());
CREATE POLICY company_update ON "review_invites" FOR UPDATE USING (company_id = app_current_company() OR app_platform_admin()) WITH CHECK (company_id = app_current_company() OR app_platform_admin());

-- Reviews: anyone reads a published one; the reviewer reads their own whatever its state; only the platform's own code writes them.
ALTER TABLE "reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reviews" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_scope ON "reviews" FOR SELECT USING (status = 'PUBLISHED' OR reviewer_id = app_current_user() OR app_platform_admin());
CREATE POLICY admin_insert ON "reviews" FOR INSERT WITH CHECK (app_platform_admin());
CREATE POLICY admin_update ON "reviews" FOR UPDATE USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "review_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "review_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_scope ON "review_events" FOR SELECT USING ((reviewer_id = app_current_user() AND to_reviewer) OR app_platform_admin());
CREATE POLICY admin_insert ON "review_events" FOR INSERT WITH CHECK (app_platform_admin());

ALTER TABLE "review_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "review_reports" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_scope ON "review_reports" FOR SELECT USING (reporter_id = app_current_user() OR app_platform_admin());
CREATE POLICY report_own ON "review_reports" FOR INSERT WITH CHECK ((reporter_id = app_current_user() AND status = 'OPEN') OR app_platform_admin());
CREATE POLICY admin_update ON "review_reports" FOR UPDATE USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "review_cases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "review_cases" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_scope ON "review_cases" FOR SELECT USING (opened_by_id = app_current_user() OR company_id = app_current_company() OR app_platform_admin());
CREATE POLICY admin_insert ON "review_cases" FOR INSERT WITH CHECK (app_platform_admin());
CREATE POLICY admin_update ON "review_cases" FOR UPDATE USING (app_platform_admin()) WITH CHECK (app_platform_admin());

-- Reputation is public to read and written only by the platform.
ALTER TABLE "reputation_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reputation_snapshots" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_all ON "reputation_snapshots" FOR SELECT USING (true);
CREATE POLICY admin_insert ON "reputation_snapshots" FOR INSERT WITH CHECK (app_platform_admin());
