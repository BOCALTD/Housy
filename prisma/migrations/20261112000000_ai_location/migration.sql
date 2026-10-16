-- CreateEnum
CREATE TYPE "AiRunStatus" AS ENUM ('OK', 'FALLBACK', 'ERROR', 'LIMITED', 'DENIED');

-- CreateEnum
CREATE TYPE "AiSuggestionKind" AS ENUM ('DOCUMENT_CATEGORY', 'CORRESPONDENCE_SUMMARY');

-- CreateEnum
CREATE TYPE "AiSuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "ai_runs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT,
    "user_id" TEXT,
    "visitor_key" TEXT NOT NULL DEFAULT '',
    "feature" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "AiRunStatus" NOT NULL,
    "input_chars" INTEGER NOT NULL DEFAULT 0,
    "output_chars" INTEGER NOT NULL DEFAULT 0,
    "ms" INTEGER NOT NULL DEFAULT 0,
    "subject_type" TEXT NOT NULL DEFAULT '',
    "subject_id" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_suggestions" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "kind" "AiSuggestionKind" NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "status" "AiSuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "created_by_id" TEXT NOT NULL,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_runs_company_id_created_at_idx" ON "ai_runs"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_runs_user_id_created_at_idx" ON "ai_runs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_runs_feature_created_at_idx" ON "ai_runs"("feature", "created_at");

-- CreateIndex
CREATE INDEX "ai_suggestions_company_id_status_idx" ON "ai_suggestions"("company_id", "status");

-- CreateIndex
CREATE INDEX "ai_suggestions_subject_type_subject_id_idx" ON "ai_suggestions"("subject_type", "subject_id");


-- Coordinates (approximate and optional)
ALTER TABLE "assets" ADD COLUMN "lat" DOUBLE PRECISION, ADD COLUMN "lng" DOUBLE PRECISION;
ALTER TABLE "listings" ADD COLUMN "lat" DOUBLE PRECISION, ADD COLUMN "lng" DOUBLE PRECISION;
ALTER TABLE "assets" ADD CONSTRAINT assets_position CHECK ((lat IS NULL) = (lng IS NULL) AND (lat IS NULL OR (lat BETWEEN 3.5 AND 14.5 AND lng BETWEEN 2.5 AND 15.0)));
ALTER TABLE "listings" ADD CONSTRAINT listings_position CHECK ((lat IS NULL) = (lng IS NULL) AND (lat IS NULL OR (lat BETWEEN 3.5 AND 14.5 AND lng BETWEEN 2.5 AND 15.0)));

ALTER TABLE "ai_runs" ADD CONSTRAINT ai_runs_sizes CHECK (input_chars >= 0 AND output_chars >= 0 AND ms >= 0 AND char_length(feature) BETWEEN 1 AND 60 AND char_length(note) <= 300);
ALTER TABLE "ai_suggestions" ADD CONSTRAINT ai_suggestions_state CHECK (confidence BETWEEN 0 AND 100 AND (status = 'PENDING') = (reviewed_by_id IS NULL) AND char_length(review_note) <= 500);

-- The audit trail is the platform's: a company reads its own rows, nobody changes or removes any.
ALTER TABLE "ai_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY company_read ON "ai_runs" FOR SELECT USING (company_id = app_current_company() OR app_platform_admin());
CREATE POLICY admin_insert ON "ai_runs" FOR INSERT WITH CHECK (app_platform_admin());

ALTER TABLE "ai_suggestions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_suggestions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_suggestions" FOR ALL USING (company_id = app_current_company()) WITH CHECK (company_id = app_current_company());
