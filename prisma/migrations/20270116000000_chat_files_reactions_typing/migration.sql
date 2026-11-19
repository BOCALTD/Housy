-- Chats: files and voice notes, emoji reactions, and a typing indicator.
-- AlterEnum


ALTER TYPE "MessageKind" ADD VALUE 'FILE';
ALTER TYPE "MessageKind" ADD VALUE 'VOICE';

-- AlterTable
ALTER TABLE "conversation_members" ADD COLUMN     "typing_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "message_attachments" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "uploader_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "duration_ms" INTEGER,
    "bytes" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_reactions" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "message_attachments_message_id_key" ON "message_attachments"("message_id");

-- CreateIndex
CREATE INDEX "message_attachments_conversation_id_idx" ON "message_attachments"("conversation_id");

-- CreateIndex
CREATE INDEX "message_reactions_conversation_id_idx" ON "message_reactions"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_reactions_message_id_user_id_key" ON "message_reactions"("message_id", "user_id");

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "message_attachments" ADD CONSTRAINT message_attachments_size CHECK (size_bytes > 0 AND size_bytes <= 10485760 AND octet_length(bytes) = size_bytes AND char_length(name) BETWEEN 1 AND 130 AND (duration_ms IS NULL OR duration_ms BETWEEN 1 AND 185000));
ALTER TABLE "message_attachments" ADD CONSTRAINT message_attachments_type CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/plain', 'text/csv', 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/x-m4a'));
ALTER TABLE "message_reactions" ADD CONSTRAINT message_reactions_emoji CHECK (emoji IN ('👍', '❤️', '😂', '😮', '😢', '🙏'));

-- Read by the people in the conversation, and by the platform administrator once the message is reported, as messages are.
ALTER TABLE "message_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message_attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY member_select ON "message_attachments" FOR SELECT USING (
  conv_member(conversation_id) OR (app_platform_admin() AND EXISTS (SELECT 1 FROM message_reports r WHERE r.message_id = message_attachments.message_id)));
CREATE POLICY sender_insert ON "message_attachments" FOR INSERT WITH CHECK (
  uploader_id = app_current_user() AND conv_member(conversation_id)
  AND EXISTS (SELECT 1 FROM messages m WHERE m.id = message_id AND m.sender_id = app_current_user() AND m.conversation_id = message_attachments.conversation_id));

ALTER TABLE "message_reactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message_reactions" FORCE ROW LEVEL SECURITY;
CREATE POLICY member_select ON "message_reactions" FOR SELECT USING (conv_member(conversation_id));
CREATE POLICY own_insert ON "message_reactions" FOR INSERT WITH CHECK (
  user_id = app_current_user() AND conv_member(conversation_id)
  AND EXISTS (SELECT 1 FROM messages m WHERE m.id = message_id AND m.conversation_id = message_reactions.conversation_id));
CREATE POLICY own_update ON "message_reactions" FOR UPDATE USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user() AND conv_member(conversation_id));
CREATE POLICY own_delete ON "message_reactions" FOR DELETE USING (user_id = app_current_user());
