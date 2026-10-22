-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "failures" INTEGER NOT NULL DEFAULT 0,
    "last_success_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_outbox" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "link" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "push_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");
CREATE INDEX "push_outbox_sent_at_created_at_idx" ON "push_outbox"("sent_at", "created_at");

ALTER TABLE "push_subscriptions" ADD CONSTRAINT push_subscriptions_shape CHECK (
  endpoint LIKE 'https://%' AND char_length(endpoint) <= 1000 AND char_length(p256dh) BETWEEN 80 AND 100 AND char_length(auth) BETWEEN 16 AND 30 AND char_length(label) <= 120 AND failures >= 0
);
ALTER TABLE "push_outbox" ADD CONSTRAINT push_outbox_shape CHECK (char_length(title) <= 160 AND char_length(body) <= 300 AND char_length(link) <= 500 AND attempts >= 0);

-- A person manages their own devices; the sending job (platform context) reads and tidies them.
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "push_subscriptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY own_devices ON "push_subscriptions" FOR ALL USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
CREATE POLICY platform_admin ON "push_subscriptions" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

-- Anyone who can notify a person can queue a push for them, as with email; only the sending job reads the queue.
ALTER TABLE "push_outbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "push_outbox" FORCE ROW LEVEL SECURITY;
CREATE POLICY queue_insert ON "push_outbox" FOR INSERT WITH CHECK (true);
CREATE POLICY platform_admin ON "push_outbox" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
