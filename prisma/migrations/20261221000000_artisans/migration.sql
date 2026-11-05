-- Artisans: tradespeople registered with a company (its contractors), offered to that company's clients after a deal closes.
ALTER TABLE "contractors" ADD COLUMN "trades" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "contractors" ADD COLUMN "areas" TEXT NOT NULL DEFAULT '';
ALTER TABLE "contractors" ADD COLUMN "bio" TEXT NOT NULL DEFAULT '';
ALTER TABLE "contractors" ADD COLUMN "years_experience" INTEGER;
ALTER TABLE "contractors" ADD COLUMN "offer_to_clients" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "contractors" ADD COLUMN "user_id" TEXT;
-- A client may read the artisans a company chose to offer (the service shows names, trades and areas, never phone or email).
CREATE POLICY offered_read ON "contractors" FOR SELECT USING (offer_to_clients AND active);

CREATE TABLE "artisan_applications" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "trades" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "areas" TEXT NOT NULL DEFAULT '',
    "years_experience" INTEGER,
    "bio" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decision_note" TEXT NOT NULL DEFAULT '',
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "contractor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "artisan_applications_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "artisan_applications_company_id_user_id_key" ON "artisan_applications"("company_id", "user_id");
ALTER TABLE "artisan_applications" ADD CONSTRAINT "artisan_applications_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "artisan_applications" ADD CONSTRAINT "artisan_applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "artisan_requests" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "contractor_id" TEXT,
    "deal_id" TEXT,
    "trade" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "preferred_on" DATE,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "company_note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "artisan_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "artisan_requests_company_id_status_idx" ON "artisan_requests"("company_id", "status");
CREATE INDEX "artisan_requests_user_id_idx" ON "artisan_requests"("user_id");
ALTER TABLE "artisan_requests" ADD CONSTRAINT "artisan_requests_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "artisan_requests" ADD CONSTRAINT "artisan_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "artisan_offers" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissed_at" TIMESTAMP(3),
    CONSTRAINT "artisan_offers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "artisan_offers_deal_id_user_id_key" ON "artisan_offers"("deal_id", "user_id");
CREATE INDEX "artisan_offers_user_id_idx" ON "artisan_offers"("user_id");
ALTER TABLE "artisan_offers" ADD CONSTRAINT "artisan_offers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "artisan_offers" ADD CONSTRAINT "artisan_offers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Each of the three is visible to its company and to the person it is about.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['artisan_applications', 'artisan_requests', 'artisan_offers']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY company_rows ON %I FOR ALL USING (company_id = app_current_company()) WITH CHECK (company_id = app_current_company())', t);
    EXECUTE format('CREATE POLICY own_rows ON %I FOR ALL USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user())', t);
  END LOOP;
END $$;
