-- CreateTable
CREATE TABLE "saved_searches" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "q" TEXT NOT NULL DEFAULT '',
    "max_kobo" BIGINT,
    "min_beds" INTEGER,
    "alerts_on" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_searches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watched_listings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watched_listings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_searches_user_id_idx" ON "saved_searches"("user_id");

-- CreateIndex
CREATE INDEX "saved_searches_alerts_on_city_idx" ON "saved_searches"("alerts_on", "city");

-- CreateIndex
CREATE UNIQUE INDEX "watched_listings_user_id_listing_id_key" ON "watched_listings"("user_id", "listing_id");

-- CreateIndex
CREATE INDEX "watched_listings_listing_id_idx" ON "watched_listings"("listing_id");


ALTER TABLE "saved_searches" ADD CONSTRAINT saved_search_name CHECK (char_length(btrim(name)) BETWEEN 1 AND 80 AND char_length(city) <= 80 AND char_length(q) <= 120);
ALTER TABLE "saved_searches" ADD CONSTRAINT saved_search_values CHECK ((max_kobo IS NULL OR max_kobo > 0) AND (min_beds IS NULL OR min_beds BETWEEN 0 AND 99) AND purpose IN ('', 'SALE', 'RENT', 'LEASE'));

-- A person sees and changes only their own. The platform reads them to find who a new property matches.
ALTER TABLE "saved_searches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saved_searches" FORCE ROW LEVEL SECURITY;
CREATE POLICY own_or_admin ON "saved_searches" FOR ALL USING (user_id = app_current_user() OR app_platform_admin()) WITH CHECK (user_id = app_current_user() OR app_platform_admin());
ALTER TABLE "watched_listings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "watched_listings" FORCE ROW LEVEL SECURITY;
CREATE POLICY own_or_admin ON "watched_listings" FOR ALL USING (user_id = app_current_user() OR app_platform_admin()) WITH CHECK (user_id = app_current_user() OR app_platform_admin());
