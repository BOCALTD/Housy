-- Phase 10b: vacancy reports, their photos, history and the owner-authorisation leads. A report is a sighting, never a listing.

-- CreateEnum
CREATE TYPE "VacancyStage" AS ENUM ('SUBMITTED', 'DUPLICATE_CHECK', 'INITIAL_REVIEW', 'LOCATION_VERIFICATION', 'AVAILABILITY_CONFIRMATION', 'OWNER_VERIFICATION', 'REWARD_REVIEW');

-- CreateEnum
CREATE TYPE "VacancyOutcome" AS ENUM ('OPEN', 'APPROVED', 'REJECTED', 'NEEDS_INFO', 'MERGED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "VacancyLeadStatus" AS ENUM ('CONTACTING', 'AUTHORISED', 'DECLINED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "vacancy_reports" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "reporter_name" TEXT NOT NULL,
    "property_type" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "bedrooms" INTEGER,
    "address" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "address_key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "description_hash" TEXT NOT NULL,
    "observed_on" DATE NOT NULL,
    "owner_contact" TEXT NOT NULL DEFAULT '',
    "allow_contact" BOOLEAN NOT NULL DEFAULT false,
    "show_name_to_owner" BOOLEAN NOT NULL DEFAULT false,
    "stage" "VacancyStage" NOT NULL DEFAULT 'SUBMITTED',
    "outcome" "VacancyOutcome" NOT NULL DEFAULT 'OPEN',
    "signals" TEXT NOT NULL DEFAULT '',
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "cluster_id" TEXT NOT NULL,
    "duplicate_of_id" TEXT,
    "merged_into_id" TEXT,
    "review_note" TEXT NOT NULL DEFAULT '',
    "reject_reason" TEXT NOT NULL DEFAULT '',
    "question" TEXT NOT NULL DEFAULT '',
    "reply" TEXT NOT NULL DEFAULT '',
    "appealed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "vacancy_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vacancy_files" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vacancy_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vacancy_events" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "stage" "VacancyStage",
    "outcome" "VacancyOutcome",
    "actor_name" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "to_reporter" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vacancy_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vacancy_leads" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "status" "VacancyLeadStatus" NOT NULL DEFAULT 'CONTACTING',
    "contact_name" TEXT NOT NULL,
    "authorisation_note" TEXT NOT NULL DEFAULT '',
    "authorised_at" TIMESTAMP(3),
    "listing_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vacancy_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vacancy_reports_ref_key" ON "vacancy_reports"("ref");

-- CreateIndex
CREATE INDEX "vacancy_reports_reporter_id_created_at_idx" ON "vacancy_reports"("reporter_id", "created_at");

-- CreateIndex
CREATE INDEX "vacancy_reports_stage_outcome_idx" ON "vacancy_reports"("stage", "outcome");

-- CreateIndex
CREATE INDEX "vacancy_reports_cluster_id_idx" ON "vacancy_reports"("cluster_id");

-- CreateIndex
CREATE INDEX "vacancy_reports_address_key_idx" ON "vacancy_reports"("address_key");

-- CreateIndex
CREATE INDEX "vacancy_reports_description_hash_idx" ON "vacancy_reports"("description_hash");

-- CreateIndex
CREATE INDEX "vacancy_reports_state_city_area_idx" ON "vacancy_reports"("state", "city", "area");

-- CreateIndex
CREATE INDEX "vacancy_files_report_id_idx" ON "vacancy_files"("report_id");

-- CreateIndex
CREATE INDEX "vacancy_files_sha256_idx" ON "vacancy_files"("sha256");

-- CreateIndex
CREATE INDEX "vacancy_events_report_id_created_at_idx" ON "vacancy_events"("report_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "vacancy_leads_report_id_key" ON "vacancy_leads"("report_id");

-- AddForeignKey
ALTER TABLE "vacancy_files" ADD CONSTRAINT "vacancy_files_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "vacancy_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacancy_events" ADD CONSTRAINT "vacancy_events_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "vacancy_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacancy_leads" ADD CONSTRAINT "vacancy_leads_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "vacancy_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------- Rules the database holds ----------
ALTER TABLE "vacancy_reports" ADD CONSTRAINT vacancy_coords CHECK ((lat IS NULL) = (lng IS NULL) AND (lat IS NULL OR (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180)));
ALTER TABLE "vacancy_reports" ADD CONSTRAINT vacancy_bedrooms CHECK (bedrooms IS NULL OR bedrooms BETWEEN 0 AND 100);
ALTER TABLE "vacancy_reports" ADD CONSTRAINT vacancy_rejected_reason CHECK (outcome <> 'REJECTED' OR char_length(btrim(reject_reason)) > 0);
ALTER TABLE "vacancy_reports" ADD CONSTRAINT vacancy_needs_question CHECK (outcome <> 'NEEDS_INFO' OR char_length(btrim(question)) > 0);
ALTER TABLE "vacancy_reports" ADD CONSTRAINT vacancy_merged_target CHECK (outcome <> 'MERGED' OR (merged_into_id IS NOT NULL AND merged_into_id <> id));
ALTER TABLE "vacancy_reports" ADD CONSTRAINT vacancy_closed_time CHECK (outcome IN ('OPEN', 'NEEDS_INFO') OR closed_at IS NOT NULL);
ALTER TABLE "vacancy_reports" ADD CONSTRAINT vacancy_approved_late CHECK (outcome <> 'APPROVED' OR stage = 'REWARD_REVIEW');
ALTER TABLE "vacancy_reports" ADD CONSTRAINT vacancy_description_len CHECK (char_length(btrim(description)) >= 20);
ALTER TABLE "vacancy_files" ADD CONSTRAINT vacancy_file_size CHECK (size_bytes > 0 AND size_bytes <= 4194304);
ALTER TABLE "vacancy_leads" ADD CONSTRAINT vacancy_lead_authorised CHECK (status <> 'AUTHORISED' OR (authorised_at IS NOT NULL AND char_length(btrim(authorisation_note)) > 0));

-- ---------- Row-level security ----------
-- The reporter reads and creates only their own reports. The review team (the platform administrator) reads and writes all of them.
-- Nothing here is readable by the public, by an owner, or by another reporter.
ALTER TABLE "vacancy_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vacancy_reports" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_own ON "vacancy_reports" FOR SELECT USING (reporter_id = app_current_user() OR app_platform_admin());
CREATE POLICY create_own ON "vacancy_reports" FOR INSERT WITH CHECK ((reporter_id = app_current_user() AND stage = 'SUBMITTED' AND outcome = 'OPEN') OR app_platform_admin());
CREATE POLICY admin_update ON "vacancy_reports" FOR UPDATE USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "vacancy_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vacancy_files" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_own ON "vacancy_files" FOR SELECT USING (app_platform_admin() OR EXISTS (SELECT 1 FROM vacancy_reports r WHERE r.id = report_id AND r.reporter_id = app_current_user()));
CREATE POLICY create_own ON "vacancy_files" FOR INSERT WITH CHECK (app_platform_admin() OR EXISTS (SELECT 1 FROM vacancy_reports r WHERE r.id = report_id AND r.reporter_id = app_current_user()));

ALTER TABLE "vacancy_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vacancy_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_own ON "vacancy_events" FOR SELECT USING (app_platform_admin() OR (to_reporter AND EXISTS (SELECT 1 FROM vacancy_reports r WHERE r.id = report_id AND r.reporter_id = app_current_user())));
CREATE POLICY admin_write ON "vacancy_events" FOR INSERT WITH CHECK (app_platform_admin());

ALTER TABLE "vacancy_leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vacancy_leads" FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_only ON "vacancy_leads" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
