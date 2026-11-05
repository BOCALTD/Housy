-- Ratings for artisan jobs: once a company has arranged a job, the client who asked can rate the artisan once (1 to 5 stars
-- and a few words). The company reads the ratings of its own artisans; clients see averages, never who wrote what.
CREATE TABLE "artisan_reviews" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "contractor_id" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artisan_reviews_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "artisan_reviews_stars_check" CHECK ("stars" BETWEEN 1 AND 5)
);
CREATE UNIQUE INDEX "artisan_reviews_request_id_key" ON "artisan_reviews"("request_id");
CREATE INDEX "artisan_reviews_company_id_contractor_id_idx" ON "artisan_reviews"("company_id", "contractor_id");
ALTER TABLE "artisan_reviews" ADD CONSTRAINT "artisan_reviews_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "artisan_reviews" ADD CONSTRAINT "artisan_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "artisan_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "artisan_reviews" FORCE ROW LEVEL SECURITY;
-- The company reads its artisans' ratings but cannot write or change them; the client writes their own, once.
CREATE POLICY company_read ON "artisan_reviews" FOR SELECT USING (company_id = app_current_company());
CREATE POLICY own_rows ON "artisan_reviews" FOR ALL USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
