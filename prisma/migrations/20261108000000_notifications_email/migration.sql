-- CreateEnum
CREATE TYPE "EmailCategory" AS ENUM ('ESSENTIAL', 'ACTIVITY', 'PROMOTIONAL');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'DEAD', 'SKIPPED', 'HELD', 'DIGESTED');

-- CreateEnum
CREATE TYPE "DigestMode" AS ENUM ('INSTANT', 'DAILY');

-- CreateTable
CREATE TABLE "notification_prefs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "email_activity" BOOLEAN NOT NULL DEFAULT true,
    "email_alerts" BOOLEAN NOT NULL DEFAULT true,
    "email_promotional" BOOLEAN NOT NULL DEFAULT false,
    "digest" "DigestMode" NOT NULL DEFAULT 'INSTANT',
    "quiet_start" INTEGER,
    "quiet_end" INTEGER,
    "areas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_prefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_outbox" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "category" "EmailCategory" NOT NULL,
    "template" TEXT NOT NULL,
    "vars" JSONB NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT NOT NULL DEFAULT '',
    "skip_reason" TEXT NOT NULL DEFAULT '',
    "provider" TEXT NOT NULL DEFAULT '',
    "provider_message_id" TEXT NOT NULL DEFAULT '',
    "digest_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_log" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "kind" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_prefs_user_id_key" ON "notification_prefs"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_outbox_dedupe_key_key" ON "email_outbox"("dedupe_key");

-- CreateIndex
CREATE INDEX "email_outbox_status_next_attempt_at_idx" ON "email_outbox"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "email_outbox_user_id_status_idx" ON "email_outbox"("user_id", "status");

-- CreateIndex
CREATE INDEX "email_outbox_category_created_at_idx" ON "email_outbox"("category", "created_at");

-- CreateIndex
CREATE INDEX "notification_log_outcome_created_at_idx" ON "notification_log"("outcome", "created_at");


ALTER TABLE "notification_prefs" ADD CONSTRAINT notif_pref_hours CHECK ((quiet_start IS NULL) = (quiet_end IS NULL) AND (quiet_start IS NULL OR (quiet_start BETWEEN 0 AND 23 AND quiet_end BETWEEN 0 AND 23 AND quiet_start <> quiet_end)));
ALTER TABLE "notification_prefs" ADD CONSTRAINT notif_pref_areas CHECK (cardinality(areas) <= 10);
ALTER TABLE "email_outbox" ADD CONSTRAINT outbox_attempts CHECK (attempts BETWEEN 0 AND 20);
ALTER TABLE "email_outbox" ADD CONSTRAINT outbox_sent CHECK (status <> 'SENT' OR sent_at IS NOT NULL);

-- Preferences belong to the person. The platform reads them when it decides what to send.
ALTER TABLE "notification_prefs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_prefs" FORCE ROW LEVEL SECURITY;
CREATE POLICY own_prefs ON "notification_prefs" FOR ALL USING (user_id = app_current_user() OR app_platform_admin()) WITH CHECK (user_id = app_current_user() OR app_platform_admin());

-- Anything in the platform may queue an email; only the platform administrator can read or change the queue.
ALTER TABLE "email_outbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_outbox" FORCE ROW LEVEL SECURITY;
CREATE POLICY queue_insert ON "email_outbox" FOR INSERT WITH CHECK (true);
CREATE POLICY admin_read ON "email_outbox" FOR SELECT USING (app_platform_admin());
CREATE POLICY admin_update ON "email_outbox" FOR UPDATE USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "notification_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_log" FORCE ROW LEVEL SECURITY;
CREATE POLICY log_insert ON "notification_log" FOR INSERT WITH CHECK (true);
CREATE POLICY admin_read ON "notification_log" FOR SELECT USING (app_platform_admin());
