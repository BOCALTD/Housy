-- Bulk messaging: a company emails its consenting clients or its tenants, one email each, with a link to stop its messages.
-- CreateEnum
CREATE TYPE "BulkAudience" AS ENUM ('CLIENTS', 'TENANTS');

-- CreateEnum
CREATE TYPE "BulkStatus" AS ENUM ('SENDING', 'SENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BulkRecipientStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'SKIPPED', 'FAILED', 'DEAD');

-- CreateTable
CREATE TABLE "bulk_messages" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "audience" "BulkAudience" NOT NULL,
    "asset_id" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "BulkStatus" NOT NULL DEFAULT 'SENDING',
    "recipients" INTEGER NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "bulk_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_recipients" (
    "id" TEXT NOT NULL,
    "bulk_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "status" "BulkRecipientStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT NOT NULL DEFAULT '',
    "skip_reason" TEXT NOT NULL DEFAULT '',
    "provider_message_id" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "bulk_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_opt_outs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bulk_opt_outs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bulk_messages_ref_key" ON "bulk_messages"("ref");

-- CreateIndex
CREATE INDEX "bulk_messages_company_id_created_at_idx" ON "bulk_messages"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "bulk_recipients_status_next_attempt_at_idx" ON "bulk_recipients"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "bulk_recipients_company_id_created_at_idx" ON "bulk_recipients"("company_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "bulk_recipients_bulk_id_email_key" ON "bulk_recipients"("bulk_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "bulk_opt_outs_company_id_email_key" ON "bulk_opt_outs"("company_id", "email");

-- AddForeignKey
ALTER TABLE "bulk_recipients" ADD CONSTRAINT "bulk_recipients_bulk_id_fkey" FOREIGN KEY ("bulk_id") REFERENCES "bulk_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "bulk_messages" ADD CONSTRAINT "bulk_messages_values" CHECK (recipients >= 0 AND char_length(subject) BETWEEN 1 AND 150 AND char_length(body) BETWEEN 1 AND 5000);
ALTER TABLE "bulk_recipients" ADD CONSTRAINT "bulk_recipients_source" CHECK (source IN ('CLIENT', 'TENANT') AND email = lower(email) AND position('@' in email) > 1);
ALTER TABLE "bulk_opt_outs" ADD CONSTRAINT "bulk_opt_outs_email" CHECK (email = lower(email) AND position('@' in email) > 1);

-- A company sees and writes only its own sends; sending happens as the platform.
ALTER TABLE "bulk_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bulk_messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "bulk_messages" FOR ALL USING (company_id = app_current_company()) WITH CHECK (company_id = app_current_company());
CREATE POLICY platform_admin ON "bulk_messages" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
ALTER TABLE "bulk_recipients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bulk_recipients" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "bulk_recipients" FOR ALL USING (company_id = app_current_company()) WITH CHECK (company_id = app_current_company());
CREATE POLICY platform_admin ON "bulk_recipients" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
-- An opt-out is the recipient's choice: the company can read it (to leave them out) but never remove it.
ALTER TABLE "bulk_opt_outs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bulk_opt_outs" FORCE ROW LEVEL SECURITY;
CREATE POLICY company_read ON "bulk_opt_outs" FOR SELECT USING (company_id = app_current_company());
CREATE POLICY platform_admin ON "bulk_opt_outs" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

