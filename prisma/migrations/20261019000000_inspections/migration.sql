-- Phase 6a: inspections, findings and evidence photographs.

-- CreateEnum
CREATE TYPE "InspectionPurpose" AS ENUM ('ROUTINE', 'PRE_LEASE', 'MOVE_IN', 'MOVE_OUT', 'VALUATION', 'MAINTENANCE_ASSESSMENT', 'CONSTRUCTION', 'CONDITION_SURVEY');

-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('SCHEDULED', 'SUBMITTED', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ConditionRating" AS ENUM ('EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "CheckResult" AS ENUM ('PENDING', 'PASS', 'ATTENTION', 'FAIL', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "DefectSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "inspection_templates" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "asset_class" "AssetClass",
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_template_items" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "inspection_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspections" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "template_id" TEXT,
    "lease_id" TEXT,
    "ref" TEXT NOT NULL,
    "purpose" "InspectionPurpose" NOT NULL,
    "status" "InspectionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduled_for" DATE NOT NULL,
    "location" TEXT NOT NULL DEFAULT '',
    "inspector_id" TEXT,
    "responsible_id" TEXT,
    "participants" TEXT NOT NULL DEFAULT '',
    "conducted_on" DATE,
    "condition_rating" "ConditionRating",
    "summary" TEXT NOT NULL DEFAULT '',
    "recommended_actions" TEXT NOT NULL DEFAULT '',
    "estimated_repair_kobo" BIGINT,
    "follow_up_by" DATE,
    "operating_hours" INTEGER,
    "technical_notes" TEXT NOT NULL DEFAULT '',
    "recurrence_months" INTEGER,
    "rolled_from_id" TEXT,
    "submitted_by_id" TEXT,
    "submitted_at" TIMESTAMP(3),
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "return_note" TEXT NOT NULL DEFAULT '',
    "cancel_reason" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_responses" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "inspection_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "result" "CheckResult" NOT NULL DEFAULT 'PENDING',
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "inspection_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_findings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "inspection_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "severity" "DefectSeverity" NOT NULL,
    "safety_risk" BOOLEAN NOT NULL DEFAULT false,
    "estimated_cost_kobo" BIGINT,
    "recommended_action" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_photos" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'EVIDENCE',
    "caption" TEXT NOT NULL DEFAULT '',
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inspection_templates_company_id_name_key" ON "inspection_templates"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_template_items_template_id_sort_order_key" ON "inspection_template_items"("template_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "inspections_rolled_from_id_key" ON "inspections"("rolled_from_id");

-- CreateIndex
CREATE UNIQUE INDEX "inspections_company_id_ref_key" ON "inspections"("company_id", "ref");

-- CreateIndex
CREATE INDEX "inspections_company_id_status_scheduled_for_idx" ON "inspections"("company_id", "status", "scheduled_for");

-- CreateIndex
CREATE INDEX "inspections_asset_id_conducted_on_idx" ON "inspections"("asset_id", "conducted_on");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_responses_inspection_id_sort_order_key" ON "inspection_responses"("inspection_id", "sort_order");

-- CreateIndex
CREATE INDEX "inspection_findings_company_id_inspection_id_idx" ON "inspection_findings"("company_id", "inspection_id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_photos_storage_key_key" ON "evidence_photos"("storage_key");

-- CreateIndex
CREATE INDEX "evidence_photos_company_id_subject_type_subject_id_idx" ON "evidence_photos"("company_id", "subject_type", "subject_id");

-- AddForeignKey
ALTER TABLE "inspection_template_items" ADD CONSTRAINT "inspection_template_items_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "inspection_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "inspection_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_inspector_id_fkey" FOREIGN KEY ("inspector_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_rolled_from_id_fkey" FOREIGN KEY ("rolled_from_id") REFERENCES "inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_responses" ADD CONSTRAINT "inspection_responses_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_findings" ADD CONSTRAINT "inspection_findings_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "inspections" ADD CONSTRAINT "inspections_estimate" CHECK ("estimated_repair_kobo" IS NULL OR "estimated_repair_kobo" >= 0);
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_recurrence" CHECK ("recurrence_months" IS NULL OR "recurrence_months" BETWEEN 1 AND 120);
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_hours" CHECK ("operating_hours" IS NULL OR "operating_hours" >= 0);
ALTER TABLE "inspection_findings" ADD CONSTRAINT "inspection_findings_estimate" CHECK ("estimated_cost_kobo" IS NULL OR "estimated_cost_kobo" >= 0);
ALTER TABLE "evidence_photos" ADD CONSTRAINT "evidence_photos_size" CHECK ("size_bytes" > 0);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['inspection_templates','inspection_template_items','inspections','inspection_responses',
                           'inspection_findings','evidence_photos']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL
                      USING (company_id = app_current_company())
                      WITH CHECK (company_id = app_current_company())', t);
  END LOOP;
END $$;
