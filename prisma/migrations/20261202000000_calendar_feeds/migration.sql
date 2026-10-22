-- CreateTable
CREATE TABLE "calendar_feeds" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_feeds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_feeds_user_id_key" ON "calendar_feeds"("user_id");
CREATE UNIQUE INDEX "calendar_feeds_token_hash_key" ON "calendar_feeds"("token_hash");

ALTER TABLE "calendar_feeds" ADD CONSTRAINT calendar_feeds_hash CHECK (token_hash ~ '^[0-9a-f]{64}$');

-- A person manages their own feed. A calendar app presents the secret, and only the row with that secret's hash is visible to it.
ALTER TABLE "calendar_feeds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calendar_feeds" FORCE ROW LEVEL SECURITY;
CREATE POLICY own_feed ON "calendar_feeds" FOR ALL USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
CREATE POLICY by_token ON "calendar_feeds" FOR SELECT USING (token_hash = app_api_token());
