-- Phase 8a: clients, leads, lead sources, activities, requirements and matches, branches and teams.

ALTER TABLE "memberships" ADD COLUMN "branch_id" TEXT, ADD COLUMN "team_id" TEXT;

-- CreateEnum
-- CreateEnum
CREATE TYPE "ClientKind" AS ENUM ('INDIVIDUAL', 'ORGANISATION');

-- CreateEnum
CREATE TYPE "SalesLeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST');

-- CreateEnum
CREATE TYPE "ActivityKind" AS ENUM ('NOTE', 'CALL', 'EMAIL', 'MEETING', 'WHATSAPP', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "Timeline" AS ENUM ('UNKNOWN', 'IMMEDIATE', 'WITHIN_3_MONTHS', 'WITHIN_6_MONTHS', 'LATER');

-- CreateEnum
CREATE TYPE "Financing" AS ENUM ('UNKNOWN', 'CASH', 'MORTGAGE_APPROVED', 'MORTGAGE_PENDING');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('SUGGESTED', 'SENT', 'INTERESTED', 'REJECTED');

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "name" TEXT NOT NULL,
    "lead_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "kind" "ClientKind" NOT NULL DEFAULT 'INDIVIDUAL',
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "email_norm" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "phone_norm" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "owner_id" TEXT NOT NULL,
    "confidential" BOOLEAN NOT NULL DEFAULT false,
    "marketing_consent" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "merged_into_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_not_duplicates" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "client_a_id" TEXT NOT NULL,
    "client_b_id" TEXT NOT NULL,
    "decided_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_not_duplicates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_sources" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "source_id" TEXT,
    "source_enquiry_id" TEXT,
    "listing_id" TEXT,
    "title" TEXT NOT NULL,
    "status" "SalesLeadStatus" NOT NULL DEFAULT 'NEW',
    "owner_id" TEXT NOT NULL,
    "assigned_by_id" TEXT,
    "assigned_at" TIMESTAMP(3),
    "budget_max_kobo" BIGINT,
    "timeline" "Timeline" NOT NULL DEFAULT 'UNKNOWN',
    "financing" "Financing" NOT NULL DEFAULT 'UNKNOWN',
    "decision_maker" BOOLEAN NOT NULL DEFAULT false,
    "score" INTEGER NOT NULL DEFAULT 0,
    "qualified_by_id" TEXT,
    "qualified_at" TIMESTAMP(3),
    "lost_reason" TEXT NOT NULL DEFAULT '',
    "converted_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_activities" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "kind" "ActivityKind" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_on" DATE,
    "assignee_id" TEXT,
    "done_at" TIMESTAMP(3),
    "done_by_id" TEXT,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_requirements" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "purpose" "ListingPurpose" NOT NULL,
    "asset_class" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL DEFAULT '',
    "bedrooms_min" INTEGER,
    "budget_min_kobo" BIGINT,
    "budget_max_kobo" BIGINT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirement_matches" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "requirement_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'SUGGESTED',
    "note" TEXT NOT NULL DEFAULT '',
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "requirement_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branches_company_id_code_key" ON "branches"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "teams_company_id_name_key" ON "teams"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "clients_company_id_ref_key" ON "clients"("company_id", "ref");

-- CreateIndex
CREATE INDEX "clients_company_id_owner_id_idx" ON "clients"("company_id", "owner_id");

-- CreateIndex
CREATE INDEX "clients_company_id_email_norm_idx" ON "clients"("company_id", "email_norm");

-- CreateIndex
CREATE INDEX "clients_company_id_phone_norm_idx" ON "clients"("company_id", "phone_norm");

-- CreateIndex
CREATE UNIQUE INDEX "client_not_duplicates_company_id_client_a_id_client_b_id_key" ON "client_not_duplicates"("company_id", "client_a_id", "client_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_sources_company_id_name_key" ON "lead_sources"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "leads_source_enquiry_id_key" ON "leads"("source_enquiry_id");

-- CreateIndex
CREATE UNIQUE INDEX "leads_company_id_ref_key" ON "leads"("company_id", "ref");

-- CreateIndex
CREATE INDEX "leads_company_id_status_idx" ON "leads"("company_id", "status");

-- CreateIndex
CREATE INDEX "leads_company_id_owner_id_idx" ON "leads"("company_id", "owner_id");

-- CreateIndex
CREATE INDEX "leads_company_id_client_id_idx" ON "leads"("company_id", "client_id");

-- CreateIndex
CREATE INDEX "client_activities_company_id_client_id_occurred_at_idx" ON "client_activities"("company_id", "client_id", "occurred_at");

-- CreateIndex
CREATE INDEX "client_activities_company_id_kind_due_on_idx" ON "client_activities"("company_id", "kind", "due_on");

-- CreateIndex
CREATE INDEX "property_requirements_company_id_client_id_idx" ON "property_requirements"("company_id", "client_id");

-- CreateIndex
CREATE INDEX "property_requirements_company_id_active_purpose_idx" ON "property_requirements"("company_id", "active", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "requirement_matches_requirement_id_listing_id_key" ON "requirement_matches"("requirement_id", "listing_id");

-- CreateIndex
CREATE INDEX "requirement_matches_company_id_listing_id_idx" ON "requirement_matches"("company_id", "listing_id");

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "lead_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_activities" ADD CONSTRAINT "client_activities_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_activities" ADD CONSTRAINT "client_activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_requirements" ADD CONSTRAINT "property_requirements_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_matches" ADD CONSTRAINT "requirement_matches_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "property_requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "memberships" ADD CONSTRAINT "memberships_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "clients" ADD CONSTRAINT clients_name_present CHECK (length(btrim(name)) >= 2);
ALTER TABLE "clients" ADD CONSTRAINT clients_not_merged_into_self CHECK (merged_into_id IS NULL OR merged_into_id <> id);
ALTER TABLE "client_not_duplicates" ADD CONSTRAINT client_not_duplicates_ordered CHECK (client_a_id < client_b_id);
ALTER TABLE "leads" ADD CONSTRAINT leads_score_range CHECK (score BETWEEN 0 AND 100);
ALTER TABLE "leads" ADD CONSTRAINT leads_budget_positive CHECK (budget_max_kobo IS NULL OR budget_max_kobo > 0);
ALTER TABLE "leads" ADD CONSTRAINT leads_qualified_has_who CHECK (status NOT IN ('QUALIFIED', 'CONVERTED') OR (qualified_by_id IS NOT NULL AND qualified_at IS NOT NULL AND budget_max_kobo IS NOT NULL AND timeline <> 'UNKNOWN'));
ALTER TABLE "leads" ADD CONSTRAINT leads_converted_dated CHECK (status <> 'CONVERTED' OR converted_at IS NOT NULL);
ALTER TABLE "leads" ADD CONSTRAINT leads_lost_has_reason CHECK (status <> 'LOST' OR length(btrim(lost_reason)) >= 3);
ALTER TABLE "client_activities" ADD CONSTRAINT client_activities_followup_dated CHECK (kind <> 'FOLLOW_UP' OR due_on IS NOT NULL);
ALTER TABLE "client_activities" ADD CONSTRAINT client_activities_done_by CHECK (done_at IS NULL OR done_by_id IS NOT NULL);
ALTER TABLE "property_requirements" ADD CONSTRAINT property_requirements_budget CHECK (budget_max_kobo > 0 AND (budget_min_kobo IS NULL OR (budget_min_kobo >= 0 AND budget_min_kobo <= budget_max_kobo)));
ALTER TABLE "property_requirements" ADD CONSTRAINT property_requirements_bedrooms CHECK (bedrooms_min IS NULL OR bedrooms_min BETWEEN 0 AND 50);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['branches','teams','clients','client_not_duplicates','lead_sources','leads','client_activities','property_requirements','requirement_matches']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL
                      USING (company_id = app_current_company())
                      WITH CHECK (company_id = app_current_company())', t);
  END LOOP;
END $$;
