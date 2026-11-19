-- AlterTable
ALTER TABLE "review_invites" ADD COLUMN     "reminded_at" TIMESTAMP(3),
ADD COLUMN     "sealed_token" TEXT,
ADD COLUMN     "sent_at" TIMESTAMP(3),
ADD COLUMN     "sent_to" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "sent_via" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "notification_prefs" ADD COLUMN     "sms_important" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "sms_outbox" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "company_id" TEXT,
    "to_phone" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT NOT NULL DEFAULT '',
    "skip_reason" TEXT NOT NULL DEFAULT '',
    "provider" TEXT NOT NULL DEFAULT '',
    "provider_message_id" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "sms_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sms_outbox_dedupe_key_key" ON "sms_outbox"("dedupe_key");

-- CreateIndex
CREATE INDEX "sms_outbox_status_next_attempt_at_idx" ON "sms_outbox"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "sms_outbox_company_id_created_at_idx" ON "sms_outbox"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "sms_outbox_user_id_created_at_idx" ON "sms_outbox"("user_id", "created_at");


-- Text messages are queued by anyone's notification and sent by the platform's worker, like email.
ALTER TABLE "sms_outbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sms_outbox" FORCE ROW LEVEL SECURITY;
CREATE POLICY queue_insert ON "sms_outbox" FOR INSERT WITH CHECK (true);
CREATE POLICY admin_read ON "sms_outbox" FOR SELECT USING (app_platform_admin());
CREATE POLICY admin_delete ON "sms_outbox" FOR DELETE USING (app_platform_admin());
CREATE POLICY admin_update ON "sms_outbox" FOR UPDATE USING (app_platform_admin()) WITH CHECK (app_platform_admin());
ALTER TABLE "sms_outbox" ADD CONSTRAINT "sms_outbox_body_len" CHECK (char_length(body) <= 320);
