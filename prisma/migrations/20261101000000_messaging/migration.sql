-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('OPEN', 'ACTIONED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('TEXT', 'PROPERTY', 'INSPECTION_REQUEST', 'INSPECTION_REPLY');

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "collaboration_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_members" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "last_read_at" TIMESTAMP(3),
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "sender_name" TEXT NOT NULL,
    "kind" "MessageKind" NOT NULL DEFAULT 'TEXT',
    "body" TEXT NOT NULL DEFAULT '',
    "details" JSONB NOT NULL DEFAULT '{}',
    "masked" BOOLEAN NOT NULL DEFAULT false,
    "reply_to_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_blocks" (
    "id" TEXT NOT NULL,
    "blocker_id" TEXT NOT NULL,
    "blocked_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_reports" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "reporter_name" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ModerationStatus" NOT NULL DEFAULT 'OPEN',
    "handled_by_id" TEXT,
    "handled_at" TIMESTAMP(3),
    "handler_note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messaging_restrictions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "set_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lifted_at" TIMESTAMP(3),
    "lifted_by_id" TEXT,

    CONSTRAINT "messaging_restrictions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_last_message_at_idx" ON "conversations"("last_message_at");

-- CreateIndex
CREATE INDEX "conversations_created_by_id_created_at_idx" ON "conversations"("created_by_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_members_conversation_id_user_id_key" ON "conversation_members"("conversation_id", "user_id");

-- CreateIndex
CREATE INDEX "conversation_members_user_id_idx" ON "conversation_members"("user_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_sender_id_created_at_idx" ON "messages"("sender_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_blocks_blocker_id_blocked_id_key" ON "user_blocks"("blocker_id", "blocked_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_reports_message_id_reporter_id_key" ON "message_reports"("message_id", "reporter_id");

-- CreateIndex
CREATE INDEX "message_reports_status_sender_id_idx" ON "message_reports"("status", "sender_id");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_restrictions_user_id_key" ON "messaging_restrictions"("user_id");

-- AddForeignKey
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------- Rules the application also checks, kept here so no path can bypass them ----------
ALTER TABLE "messages" ADD CONSTRAINT messages_body_size CHECK (char_length(body) <= 4000);
ALTER TABLE "messages" ADD CONSTRAINT messages_text_has_body CHECK (kind <> 'TEXT' OR char_length(btrim(body)) > 0);
ALTER TABLE "user_blocks" ADD CONSTRAINT user_blocks_not_self CHECK (blocker_id <> blocked_id);
ALTER TABLE "message_reports" ADD CONSTRAINT message_reports_handled CHECK (status = 'OPEN' OR (handled_by_id IS NOT NULL AND handled_at IS NOT NULL));
ALTER TABLE "message_reports" ADD CONSTRAINT message_reports_reason CHECK (char_length(btrim(reason)) >= 3);
ALTER TABLE "messaging_restrictions" ADD CONSTRAINT messaging_restrictions_lift CHECK ((lifted_at IS NULL) = (lifted_by_id IS NULL));

-- ---------- Who may see what ----------
-- Membership is asked through functions that read the member list directly, so the policies never refer back to themselves.
CREATE OR REPLACE FUNCTION conv_member(cid text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = cid AND user_id = app_current_user()) $$;
CREATE OR REPLACE FUNCTION conv_creator(cid text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT EXISTS (SELECT 1 FROM conversations WHERE id = cid AND created_by_id = app_current_user()) $$;
-- Whether either person has blocked the other. Neither is told which.
CREATE OR REPLACE FUNCTION msg_blocked(a text, b text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT EXISTS (SELECT 1 FROM user_blocks WHERE (blocker_id = a AND blocked_id = b) OR (blocker_id = b AND blocked_id = a)) $$;
GRANT EXECUTE ON FUNCTION conv_member(text), conv_creator(text), msg_blocked(text, text) TO PUBLIC;

-- Conversations and their members are read through the functions above, which run as the table owner; they are protected from the app role by these policies.
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY member_select ON "conversations" FOR SELECT USING (conv_member(id) OR created_by_id = app_current_user());
CREATE POLICY creator_insert ON "conversations" FOR INSERT WITH CHECK (created_by_id = app_current_user());
CREATE POLICY member_update ON "conversations" FOR UPDATE USING (conv_member(id)) WITH CHECK (conv_member(id));

ALTER TABLE "conversation_members" ENABLE ROW LEVEL SECURITY;
CREATE POLICY member_select ON "conversation_members" FOR SELECT USING (conv_member(conversation_id));
CREATE POLICY add_member ON "conversation_members" FOR INSERT WITH CHECK (conv_creator(conversation_id));
CREATE POLICY own_update ON "conversation_members" FOR UPDATE USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());

-- A message is read by the people in its conversation, and by the platform administrator only once someone has reported it.
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY member_select ON "messages" FOR SELECT USING (
  conv_member(conversation_id) OR (app_platform_admin() AND EXISTS (SELECT 1 FROM message_reports r WHERE r.message_id = messages.id)));
CREATE POLICY member_insert ON "messages" FOR INSERT WITH CHECK (sender_id = app_current_user() AND conv_member(conversation_id));

-- Not forced: msg_blocked() reads this table as its owner. The app role is still held to the policy below.
ALTER TABLE "user_blocks" ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON "user_blocks" FOR ALL USING (blocker_id = app_current_user()) WITH CHECK (blocker_id = app_current_user());

ALTER TABLE "message_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message_reports" FORCE ROW LEVEL SECURITY;
CREATE POLICY reporter_insert ON "message_reports" FOR INSERT WITH CHECK (reporter_id = app_current_user() AND EXISTS (SELECT 1 FROM messages m WHERE m.id = message_id));
CREATE POLICY read_own_or_admin ON "message_reports" FOR SELECT USING (reporter_id = app_current_user() OR app_platform_admin());
CREATE POLICY admin_update ON "message_reports" FOR UPDATE USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "messaging_restrictions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messaging_restrictions" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_own_or_admin ON "messaging_restrictions" FOR SELECT USING (user_id = app_current_user() OR app_platform_admin());
CREATE POLICY admin_write ON "messaging_restrictions" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
