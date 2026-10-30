-- Personal suggestions (master prompt §37): what each signed-in person looks at, saves, asks about and watches, kept for
-- 180 days and only for their own suggestions. They can see it, clear it, or turn it off. Visitors are never tracked.
ALTER TABLE "users" ADD COLUMN "personalise" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "user_signals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "listing_id" TEXT,
    "reel_id" TEXT,
    "agent_id" TEXT,
    "company_id" TEXT,
    "city" TEXT NOT NULL DEFAULT '',
    "property_type" TEXT NOT NULL DEFAULT '',
    "purpose" TEXT NOT NULL DEFAULT '',
    "price_kobo" BIGINT,
    "bedrooms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_signals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_signals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_signals_kind_check" CHECK ("kind" IN ('PROPERTY_VIEW', 'PROPERTY_SAVE', 'ENQUIRY', 'INSPECTION', 'AGENT_VIEW', 'SEARCH', 'REEL_WATCH', 'REEL_LIKE', 'REEL_SAVE'))
);
CREATE INDEX "user_signals_user_id_created_at_idx" ON "user_signals"("user_id", "created_at");

ALTER TABLE "user_signals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_signals" FORCE ROW LEVEL SECURITY;
CREATE POLICY own_signals ON "user_signals" FOR ALL USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
