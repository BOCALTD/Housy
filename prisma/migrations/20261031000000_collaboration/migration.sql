-- CreateEnum
CREATE TYPE "CollabKind" AS ENUM ('SEEKER_AGENT', 'COMPANY_COMPANY');

-- CreateEnum
CREATE TYPE "CollabPurpose" AS ENUM ('SEARCH_ASSISTANCE', 'TRANSACTION', 'INSPECTION', 'DOCUMENT_EXCHANGE', 'CO_LISTING', 'REFERRAL', 'CO_BROKERAGE', 'MARKETING', 'DEVELOPMENT', 'CONTRACTOR', 'OTHER');

-- CreateEnum
CREATE TYPE "CollabStatus" AS ENUM ('DRAFT', 'PENDING', 'ACTIVE', 'DECLINED', 'EXPIRED', 'CANCELLED', 'COMPLETED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CollabSide" AS ENUM ('SENDER', 'RECIPIENT');

-- CreateEnum
CREATE TYPE "CollabItemKind" AS ENUM ('PROPERTY', 'DEAL_SUMMARY', 'DOCUMENT', 'NOTE');

-- CreateEnum
CREATE TYPE "CollabTaskStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- CreateTable
CREATE TABLE "collaborations" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "kind" "CollabKind" NOT NULL,
    "purpose" "CollabPurpose" NOT NULL,
    "title" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT '',
    "terms" TEXT NOT NULL DEFAULT '',
    "status" "CollabStatus" NOT NULL DEFAULT 'DRAFT',
    "sender_user_id" TEXT NOT NULL,
    "sender_company_id" TEXT,
    "sender_name" TEXT NOT NULL,
    "recipient_user_id" TEXT,
    "recipient_company_id" TEXT,
    "recipient_name" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "ends_on" DATE,
    "responded_at" TIMESTAMP(3),
    "responded_by_id" TEXT,
    "response_note" TEXT NOT NULL DEFAULT '',
    "closed_at" TIMESTAMP(3),
    "closed_by_id" TEXT,
    "close_reason" TEXT NOT NULL DEFAULT '',
    "suspended_at" TIMESTAMP(3),
    "suspended_by_id" TEXT,
    "suspended_by" TEXT,
    "suspend_reason" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collaborations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collab_participants" (
    "id" TEXT NOT NULL,
    "collaboration_id" TEXT NOT NULL,
    "side" "CollabSide" NOT NULL,
    "user_id" TEXT NOT NULL,
    "company_id" TEXT,
    "name" TEXT NOT NULL,
    "can_comment" BOOLEAN NOT NULL DEFAULT true,
    "can_tasks" BOOLEAN NOT NULL DEFAULT true,
    "can_share" BOOLEAN NOT NULL DEFAULT true,
    "can_documents" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_by_id" TEXT,
    "revoke_reason" TEXT NOT NULL DEFAULT '',
    "added_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collab_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collab_items" (
    "id" TEXT NOT NULL,
    "collaboration_id" TEXT NOT NULL,
    "kind" "CollabItemKind" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "details" JSONB NOT NULL DEFAULT '{}',
    "source_type" TEXT NOT NULL DEFAULT '',
    "source_id" TEXT NOT NULL DEFAULT '',
    "side" "CollabSide" NOT NULL,
    "shared_by_id" TEXT NOT NULL,
    "shared_by_name" TEXT NOT NULL,
    "shared_by_company_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "file_key" TEXT,
    "file_name" TEXT NOT NULL DEFAULT '',
    "mime_type" TEXT NOT NULL DEFAULT '',
    "size_bytes" INTEGER NOT NULL DEFAULT 0,
    "revoked_at" TIMESTAMP(3),
    "revoked_by_id" TEXT,
    "revoke_reason" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collab_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collab_files" (
    "key" TEXT NOT NULL,
    "collaboration_id" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collab_files_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "collab_tasks" (
    "id" TEXT NOT NULL,
    "collaboration_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "milestone" BOOLEAN NOT NULL DEFAULT false,
    "assignee_id" TEXT,
    "assignee_name" TEXT NOT NULL DEFAULT '',
    "due_on" DATE,
    "status" "CollabTaskStatus" NOT NULL DEFAULT 'OPEN',
    "outcome" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT NOT NULL,
    "created_by_name" TEXT NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collab_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collab_comments" (
    "id" TEXT NOT NULL,
    "collaboration_id" TEXT NOT NULL,
    "item_id" TEXT,
    "author_id" TEXT NOT NULL,
    "author_name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collab_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collab_events" (
    "id" TEXT NOT NULL,
    "collaboration_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collab_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "collaborations_ref_key" ON "collaborations"("ref");

-- CreateIndex
CREATE INDEX "collaborations_sender_company_id_status_idx" ON "collaborations"("sender_company_id", "status");

-- CreateIndex
CREATE INDEX "collaborations_recipient_company_id_status_idx" ON "collaborations"("recipient_company_id", "status");

-- CreateIndex
CREATE INDEX "collaborations_sender_user_id_idx" ON "collaborations"("sender_user_id");

-- CreateIndex
CREATE INDEX "collaborations_recipient_user_id_idx" ON "collaborations"("recipient_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "collab_participants_collaboration_id_user_id_key" ON "collab_participants"("collaboration_id", "user_id");

-- CreateIndex
CREATE INDEX "collab_participants_user_id_idx" ON "collab_participants"("user_id");

-- CreateIndex
CREATE INDEX "collab_items_collaboration_id_created_at_idx" ON "collab_items"("collaboration_id", "created_at");

-- CreateIndex
CREATE INDEX "collab_files_collaboration_id_idx" ON "collab_files"("collaboration_id");

-- CreateIndex
CREATE INDEX "collab_tasks_collaboration_id_status_idx" ON "collab_tasks"("collaboration_id", "status");

-- CreateIndex
CREATE INDEX "collab_comments_collaboration_id_created_at_idx" ON "collab_comments"("collaboration_id", "created_at");

-- CreateIndex
CREATE INDEX "collab_events_collaboration_id_created_at_idx" ON "collab_events"("collaboration_id", "created_at");

-- AddForeignKey
ALTER TABLE "collab_participants" ADD CONSTRAINT "collab_participants_collaboration_id_fkey" FOREIGN KEY ("collaboration_id") REFERENCES "collaborations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collab_items" ADD CONSTRAINT "collab_items_collaboration_id_fkey" FOREIGN KEY ("collaboration_id") REFERENCES "collaborations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collab_tasks" ADD CONSTRAINT "collab_tasks_collaboration_id_fkey" FOREIGN KEY ("collaboration_id") REFERENCES "collaborations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collab_comments" ADD CONSTRAINT "collab_comments_collaboration_id_fkey" FOREIGN KEY ("collaboration_id") REFERENCES "collaborations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collab_events" ADD CONSTRAINT "collab_events_collaboration_id_fkey" FOREIGN KEY ("collaboration_id") REFERENCES "collaborations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Rules the database holds whatever the application does.
ALTER TABLE "collaborations" ADD CONSTRAINT collaborations_title_present CHECK (length(btrim(title)) >= 3);
ALTER TABLE "collaborations" ADD CONSTRAINT collaborations_kind_shape CHECK (
  (kind = 'SEEKER_AGENT' AND sender_company_id IS NULL AND recipient_user_id IS NOT NULL AND recipient_company_id IS NOT NULL AND recipient_user_id <> sender_user_id) OR
  (kind = 'COMPANY_COMPANY' AND sender_company_id IS NOT NULL AND recipient_company_id IS NOT NULL AND sender_company_id <> recipient_company_id)
);
ALTER TABLE "collaborations" ADD CONSTRAINT collaborations_sent_dated CHECK (status IN ('DRAFT', 'CANCELLED') OR sent_at IS NOT NULL);
ALTER TABLE "collaborations" ADD CONSTRAINT collaborations_pending_expires CHECK (status <> 'PENDING' OR expires_at IS NOT NULL);
-- The other side must answer, never the person who sent the invitation.
ALTER TABLE "collaborations" ADD CONSTRAINT collaborations_answered CHECK (
  status NOT IN ('ACTIVE', 'DECLINED') OR (responded_at IS NOT NULL AND responded_by_id IS NOT NULL AND responded_by_id <> sender_user_id)
);
ALTER TABLE "collaborations" ADD CONSTRAINT collaborations_closed_dated CHECK (status NOT IN ('CANCELLED', 'COMPLETED', 'EXPIRED') OR closed_at IS NOT NULL);
ALTER TABLE "collaborations" ADD CONSTRAINT collaborations_suspended_why CHECK (
  status <> 'SUSPENDED' OR (suspended_at IS NOT NULL AND suspended_by_id IS NOT NULL AND suspended_by IN ('SENDER', 'RECIPIENT', 'PLATFORM') AND length(btrim(suspend_reason)) >= 3)
);
ALTER TABLE "collab_items" ADD CONSTRAINT collab_items_title_present CHECK (length(btrim(title)) >= 1);
-- Revoking wipes what was shared: nothing is left to read, whoever asks.
ALTER TABLE "collab_items" ADD CONSTRAINT collab_items_revoked_wiped CHECK (
  revoked_at IS NULL OR (summary = '' AND details = '{}'::jsonb AND file_key IS NULL AND source_id = '')
);
ALTER TABLE "collab_items" ADD CONSTRAINT collab_items_revoked_by CHECK ((revoked_at IS NULL) = (revoked_by_id IS NULL));
ALTER TABLE "collab_items" ADD CONSTRAINT collab_items_document_has_file CHECK (kind <> 'DOCUMENT' OR revoked_at IS NOT NULL OR file_key IS NOT NULL);
ALTER TABLE "collab_participants" ADD CONSTRAINT collab_participants_revoked_by CHECK ((revoked_at IS NULL) = (revoked_by_id IS NULL));
ALTER TABLE "collab_tasks" ADD CONSTRAINT collab_tasks_title_present CHECK (length(btrim(title)) >= 3);
ALTER TABLE "collab_tasks" ADD CONSTRAINT collab_tasks_done_says_what CHECK (status <> 'DONE' OR (completed_at IS NOT NULL AND length(btrim(outcome)) >= 3));
ALTER TABLE "collab_comments" ADD CONSTRAINT collab_comments_body CHECK (length(btrim(body)) BETWEEN 1 AND 2000);
ALTER TABLE "collab_events" ADD CONSTRAINT collab_events_summary_present CHECK (length(btrim(summary)) >= 1);

-- A party is the sender or the recipient: a person by account, a company by workspace. The platform administrator can see all.
CREATE OR REPLACE FUNCTION collab_is_party(su text, sc text, ru text, rc text) RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT app_platform_admin() OR app_current_user() IN (su, ru) OR app_current_company() IN (sc, rc) $$;
GRANT EXECUTE ON FUNCTION collab_is_party(text, text, text, text) TO PUBLIC;

ALTER TABLE "collaborations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "collaborations" FORCE ROW LEVEL SECURITY;
CREATE POLICY party_select ON "collaborations" FOR SELECT USING (collab_is_party(sender_user_id, sender_company_id, recipient_user_id, recipient_company_id));
CREATE POLICY party_update ON "collaborations" FOR UPDATE
  USING (collab_is_party(sender_user_id, sender_company_id, recipient_user_id, recipient_company_id))
  WITH CHECK (collab_is_party(sender_user_id, sender_company_id, recipient_user_id, recipient_company_id));
CREATE POLICY sender_insert ON "collaborations" FOR INSERT
  WITH CHECK (sender_user_id = app_current_user() AND (sender_company_id IS NULL OR sender_company_id = app_current_company()));

-- Everything in a workspace is visible to the two parties and to nobody else.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['collab_participants', 'collab_items', 'collab_files', 'collab_tasks', 'collab_comments', 'collab_events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY party ON %I FOR ALL
                      USING (EXISTS (SELECT 1 FROM collaborations c WHERE c.id = collaboration_id))
                      WITH CHECK (EXISTS (SELECT 1 FROM collaborations c WHERE c.id = collaboration_id))', t);
  END LOOP;
END $$;
-- A party changes or removes only what it shared itself.
CREATE POLICY sharer_only_update ON "collab_items" AS RESTRICTIVE FOR UPDATE
  USING (shared_by_id = app_current_user() OR (shared_by_company_id IS NOT NULL AND shared_by_company_id = app_current_company()) OR app_platform_admin());
CREATE POLICY sharer_only_delete ON "collab_items" AS RESTRICTIVE FOR DELETE
  USING (shared_by_id = app_current_user() OR (shared_by_company_id IS NOT NULL AND shared_by_company_id = app_current_company()) OR app_platform_admin());

-- The other party's plan state is readable so a workspace can follow the weaker plan; nothing else about the subscription is needed.
CREATE POLICY party_read ON "subscriptions" FOR SELECT USING (
  EXISTS (SELECT 1 FROM collaborations c WHERE
    (owner_company_id IS NOT NULL AND owner_company_id IN (c.sender_company_id, c.recipient_company_id)) OR
    (owner_user_id IS NOT NULL AND owner_user_id IN (c.sender_user_id, c.recipient_user_id)))
);
