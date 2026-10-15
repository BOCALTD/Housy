-- Phase 7c-2: completion, defects, warranties, documents and handover.

ALTER TABLE "projects"
  ADD COLUMN "completion_requested_by_id" TEXT,
  ADD COLUMN "completion_requested_at" TIMESTAMP(3),
  ADD COLUMN "completion_note" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "defects_months" INTEGER NOT NULL DEFAULT 12,
  ADD COLUMN "completed_by_id" TEXT,
  ADD COLUMN "completed_at" TIMESTAMP(3),
  ADD COLUMN "defects_period_end" DATE,
  ADD COLUMN "handover_on" DATE,
  ADD COLUMN "handover_by_id" TEXT,
  ADD COLUMN "handed_to_name" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "handover_note" TEXT NOT NULL DEFAULT '';

-- CreateEnum
CREATE TYPE "DefectStatus" AS ENUM ('OPEN', 'FIXED', 'VERIFIED');

-- CreateEnum
CREATE TYPE "ProjectDocKind" AS ENUM ('DRAWING', 'CERTIFICATE', 'WARRANTY', 'MANUAL', 'HANDOVER', 'OTHER');

-- CreateTable
CREATE TABLE "project_defects" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "work_package_id" TEXT,
    "ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "severity" "DefectSeverity" NOT NULL,
    "status" "DefectStatus" NOT NULL DEFAULT 'OPEN',
    "raised_by_id" TEXT NOT NULL,
    "raised_on" DATE NOT NULL,
    "due_on" DATE,
    "fixed_by_id" TEXT,
    "fixed_on" DATE,
    "fix_note" TEXT NOT NULL DEFAULT '',
    "verified_by_id" TEXT,
    "verified_on" DATE,
    "verify_note" TEXT NOT NULL DEFAULT '',
    "work_order_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_defects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_warranties" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "coverage" TEXT NOT NULL DEFAULT '',
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "document_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_warranties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_documents" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "kind" "ProjectDocKind" NOT NULL,
    "title" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handover_items" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "done_by_id" TEXT,
    "done_on" DATE,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "handover_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_defects_company_id_project_id_ref_key" ON "project_defects"("company_id", "project_id", "ref");

-- CreateIndex
CREATE INDEX "project_defects_company_id_project_id_status_idx" ON "project_defects"("company_id", "project_id", "status");

-- CreateIndex
CREATE INDEX "project_warranties_company_id_asset_id_ends_on_idx" ON "project_warranties"("company_id", "asset_id", "ends_on");

-- CreateIndex
CREATE INDEX "project_warranties_company_id_project_id_idx" ON "project_warranties"("company_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_documents_storage_key_key" ON "project_documents"("storage_key");

-- CreateIndex
CREATE INDEX "project_documents_company_id_project_id_idx" ON "project_documents"("company_id", "project_id");

-- CreateIndex
CREATE INDEX "handover_items_company_id_project_id_sort_order_idx" ON "handover_items"("company_id", "project_id", "sort_order");

-- AddForeignKey
ALTER TABLE "project_defects" ADD CONSTRAINT "project_defects_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_warranties" ADD CONSTRAINT "project_warranties_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_items" ADD CONSTRAINT "handover_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Completion is approved by someone other than the person who asked for it. The defects period is 0 to 60 months.
ALTER TABLE "projects" ADD CONSTRAINT projects_completion_second_person
  CHECK (completed_by_id IS NULL OR completion_requested_by_id IS NULL OR completed_by_id <> completion_requested_by_id);
ALTER TABLE "projects" ADD CONSTRAINT projects_defects_months_range CHECK (defects_months BETWEEN 0 AND 60);
ALTER TABLE "projects" ADD CONSTRAINT projects_completed_has_approver
  CHECK (status <> 'COMPLETED' OR (completed_by_id IS NOT NULL AND completed_at IS NOT NULL AND defects_period_end IS NOT NULL));
ALTER TABLE "projects" ADD CONSTRAINT projects_handover_after_completion
  CHECK (handover_on IS NULL OR (status = 'COMPLETED' AND handover_by_id IS NOT NULL AND length(handed_to_name) >= 2));

-- A fixed defect names who fixed it; a verified one names a different verifier.
ALTER TABLE "project_defects" ADD CONSTRAINT project_defects_fix_recorded
  CHECK (status = 'OPEN' OR (fixed_by_id IS NOT NULL AND fixed_on IS NOT NULL));
ALTER TABLE "project_defects" ADD CONSTRAINT project_defects_verified_by_other
  CHECK (status <> 'VERIFIED' OR (verified_by_id IS NOT NULL AND verified_on IS NOT NULL AND verified_by_id <> fixed_by_id));

ALTER TABLE "project_warranties" ADD CONSTRAINT project_warranties_dates CHECK (ends_on >= starts_on);
ALTER TABLE "project_documents" ADD CONSTRAINT project_documents_size CHECK (size_bytes > 0);
ALTER TABLE "handover_items" ADD CONSTRAINT handover_items_done_by CHECK (NOT done OR (done_by_id IS NOT NULL AND done_on IS NOT NULL));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['project_defects','project_warranties','project_documents','handover_items']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL
                      USING (company_id = app_current_company())
                      WITH CHECK (company_id = app_current_company())', t);
  END LOOP;
END $$;
