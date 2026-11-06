-- Listings must be confirmed as still available every 45 days or they stop showing in search (they are not deleted, and
-- the company can confirm them again at any time). Every listing live today starts with a fresh 45 days.
ALTER TABLE "listings" ADD COLUMN "confirmed_at" TIMESTAMP(3), ADD COLUMN "confirm_reminded_at" TIMESTAMP(3);
UPDATE "listings" SET "confirmed_at" = CURRENT_TIMESTAMP WHERE "status" = 'PUBLISHED';

-- A person's own search, set once: where, rent or buy, budget and bedrooms. Shapes their home page, reels and search.
CREATE TABLE "search_prefs" (
    "user_id" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT '',
    "purpose" TEXT NOT NULL DEFAULT '',
    "max_price_kobo" BIGINT,
    "min_beds" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "search_prefs_pkey" PRIMARY KEY ("user_id")
);
ALTER TABLE "search_prefs" ADD CONSTRAINT "search_prefs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "search_prefs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "search_prefs" FORCE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON "search_prefs" FOR ALL USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
