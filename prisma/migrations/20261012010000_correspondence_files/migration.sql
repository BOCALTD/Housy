-- Phase 4: departments, correspondence register, physical file register, shared rate limits.

-- AlterTable
ALTER TABLE "companies" ADD COLUMN "ref_prefix" TEXT NOT NULL DEFAULT 'REF';

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN "department_id" TEXT;

-- CreateEnum
CREATE TYPE "CorrespondenceDirection" AS ENUM ('INCOMING', 'OUTGOING');

-- CreateEnum
CREATE TYPE "CorrespondenceStatus" AS ENUM ('REGISTERED', 'ASSIGNED', 'UNDER_REVIEW', 'RESPONSE_REQUIRED', 'DRAFT_RESPONSE', 'AWAITING_APPROVAL', 'APPROVED', 'SENT', 'AWAITING_REPLY', 'CLOSED');

-- CreateEnum
CREATE TYPE "CorrespondencePriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('IN_REGISTRY', 'ISSUED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correspondence_counters" (
    "company_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "correspondence_counters_pkey" PRIMARY KEY ("company_id", "year")
);

-- CreateTable
CREATE TABLE "correspondence" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "direction" "CorrespondenceDirection" NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'General',
    "priority" "CorrespondencePriority" NOT NULL DEFAULT 'NORMAL',
    "confidential" BOOLEAN NOT NULL DEFAULT false,
    "status" "CorrespondenceStatus" NOT NULL,
    "sender_name" TEXT NOT NULL,
    "recipient_name" TEXT NOT NULL,
    "copied_to" TEXT NOT NULL DEFAULT '',
    "external_ref" TEXT NOT NULL DEFAULT '',
    "date_received" DATE,
    "date_issued" DATE,
    "response_deadline" DATE,
    "asset_id" TEXT,
    "department_id" TEXT,
    "assignee_id" TEXT,
    "required_action" TEXT NOT NULL DEFAULT '',
    "draft_response" TEXT NOT NULL DEFAULT '',
    "drafted_by_id" TEXT,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "dispatch_method" TEXT NOT NULL DEFAULT '',
    "dispatched_at" DATE,
    "closed_at" TIMESTAMP(3),
    "closure_note" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "correspondence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correspondence_actions" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "correspondence_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "from_status" "CorrespondenceStatus",
    "to_status" "CorrespondenceStatus",
    "note" TEXT NOT NULL DEFAULT '',
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "correspondence_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correspondence_attachments" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "correspondence_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "correspondence_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "physical_files" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "file_number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "location" TEXT NOT NULL DEFAULT '',
    "department_id" TEXT,
    "asset_id" TEXT,
    "status" "FileStatus" NOT NULL DEFAULT 'IN_REGISTRY',
    "holder_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "physical_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_movements" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "holder_id" TEXT NOT NULL,
    "issued_on" DATE NOT NULL,
    "expected_return_on" DATE NOT NULL,
    "returned_on" DATE,
    "purpose" TEXT NOT NULL DEFAULT '',
    "issued_by_id" TEXT NOT NULL,
    "received_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "departments_company_id_code_key" ON "departments"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "correspondence_company_id_ref_key" ON "correspondence"("company_id", "ref");

-- CreateIndex
CREATE INDEX "correspondence_company_id_status_idx" ON "correspondence"("company_id", "status");

-- CreateIndex
CREATE INDEX "correspondence_company_id_response_deadline_idx" ON "correspondence"("company_id", "response_deadline");

-- CreateIndex
CREATE INDEX "correspondence_actions_correspondence_id_idx" ON "correspondence_actions"("correspondence_id");

-- CreateIndex
CREATE UNIQUE INDEX "correspondence_attachments_storage_key_key" ON "correspondence_attachments"("storage_key");

-- CreateIndex
CREATE INDEX "correspondence_attachments_correspondence_id_idx" ON "correspondence_attachments"("correspondence_id");

-- CreateIndex
CREATE UNIQUE INDEX "physical_files_company_id_file_number_key" ON "physical_files"("company_id", "file_number");

-- CreateIndex
CREATE INDEX "file_movements_company_id_returned_on_idx" ON "file_movements"("company_id", "returned_on");

-- CreateIndex
CREATE INDEX "file_movements_file_id_idx" ON "file_movements"("file_id");

-- AddForeignKey
ALTER TABLE "correspondence" ADD CONSTRAINT "correspondence_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correspondence" ADD CONSTRAINT "correspondence_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correspondence" ADD CONSTRAINT "correspondence_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correspondence_actions" ADD CONSTRAINT "correspondence_actions_correspondence_id_fkey" FOREIGN KEY ("correspondence_id") REFERENCES "correspondence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correspondence_attachments" ADD CONSTRAINT "correspondence_attachments_correspondence_id_fkey" FOREIGN KEY ("correspondence_id") REFERENCES "correspondence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "physical_files" ADD CONSTRAINT "physical_files_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "physical_files" ADD CONSTRAINT "physical_files_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "physical_files" ADD CONSTRAINT "physical_files_holder_id_fkey" FOREIGN KEY ("holder_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_movements" ADD CONSTRAINT "file_movements_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "physical_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-level security: every new company-owned table is isolated by company.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['departments','correspondence_counters','correspondence','correspondence_actions',
                           'correspondence_attachments','physical_files','file_movements']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL
                      USING (company_id = app_current_company())
                      WITH CHECK (company_id = app_current_company())', t);
  END LOOP;
END $$;
-- rate_limits holds only hashed keys and counters; it is platform-level and not tenant-owned.
