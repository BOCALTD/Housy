-- Company suspension
ALTER TABLE "companies" ADD COLUMN "suspended_at" TIMESTAMP(3),
ADD COLUMN "suspended_reason" TEXT NOT NULL DEFAULT '',
ADD COLUMN "suspended_by_id" TEXT;
ALTER TABLE "companies" ADD CONSTRAINT companies_suspension CHECK ((suspended_at IS NULL) OR (char_length(suspended_reason) BETWEEN 5 AND 1000 AND suspended_by_id IS NOT NULL));

ALTER TABLE "listings" ADD COLUMN "platform_hidden" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "agent_profiles" ADD COLUMN "platform_hidden" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "company_profiles" ADD COLUMN "platform_hidden" BOOLEAN NOT NULL DEFAULT false;

-- The public sees nothing of a suspended company. Companies themselves still see their own records (tenant policy).
DROP POLICY public_read ON "listings";
CREATE POLICY public_read ON "listings" FOR SELECT USING (status = 'PUBLISHED' AND NOT platform_hidden);
DROP POLICY public_read ON "agent_profiles";
CREATE POLICY public_read ON "agent_profiles" FOR SELECT USING (listed AND NOT platform_hidden);
DROP POLICY public_read ON "company_profiles";
CREATE POLICY public_read ON "company_profiles" FOR SELECT USING (listed AND NOT platform_hidden);
-- Platform administrators set and clear the flag (they can already read and review these).
CREATE POLICY platform_admin_hide ON "agent_profiles" FOR UPDATE USING (app_platform_admin()) WITH CHECK (app_platform_admin());
CREATE POLICY platform_admin_hide ON "company_profiles" FOR UPDATE USING (app_platform_admin()) WITH CHECK (app_platform_admin());
CREATE POLICY platform_admin_suspend ON "companies" FOR UPDATE USING (app_platform_admin()) WITH CHECK (app_platform_admin());

-- Amenities and title documents can now include values added by platform administrators.
ALTER TABLE "listings" DROP CONSTRAINT listings_details;
ALTER TABLE "listings" ADD CONSTRAINT listings_details CHECK (
  property_type IN ('HOUSE', 'DUPLEX', 'SEMI_DETACHED', 'TERRACE', 'BUNGALOW', 'FLAT', 'PENTHOUSE', 'MAISONETTE', 'SELF_CONTAINED', 'ROOM', 'SHARED_ROOM', 'LAND', 'OFFICE', 'SHOP', 'PLAZA', 'HOTEL', 'EVENT_CENTRE', 'WAREHOUSE', 'INDUSTRIAL', 'FILLING_STATION', 'FARM', 'PLANT_MACHINERY', 'OTHER')
  AND price_period IN ('TOTAL', 'YEAR', 'MONTH', 'NIGHT')
  AND (purpose = 'SALE') = (price_period = 'TOTAL')
  AND furnishing IN ('UNSPECIFIED', 'FURNISHED', 'SEMI_FURNISHED', 'UNFURNISHED')
  AND condition IN ('UNSPECIFIED', 'NEW', 'RENOVATED', 'GOOD', 'FAIR', 'NEEDS_WORK')
  AND construction_status IN ('COMPLETED', 'UNDER_CONSTRUCTION', 'OFF_PLAN')
  AND title_document ~ '^[A-Z][A-Z0-9_]{1,39}$'
  AND amenities ~ '^([A-Z][A-Z0-9_]{1,39}(,[A-Z][A-Z0-9_]{1,39})*)?$'
  AND (deposit_kobo IS NULL OR deposit_kobo >= 0) AND (service_charge_kobo IS NULL OR service_charge_kobo >= 0)
  AND (toilets IS NULL OR toilets BETWEEN 0 AND 99) AND (floors IS NULL OR floors BETWEEN 0 AND 200)
  AND (building_sqm IS NULL OR building_sqm BETWEEN 1 AND 10000000) AND (land_sqm IS NULL OR land_sqm BETWEEN 1 AND 100000000)
  AND (min_lease_months IS NULL OR min_lease_months BETWEEN 1 AND 1200)
  AND char_length(fees_note) <= 500 AND char_length(plot_dimensions) <= 60 AND char_length(estate_name) <= 120
  AND (video_url = '' OR video_url ~ '^https://(www\.)?(youtube\.com|youtu\.be|vimeo\.com)/')
);

-- CreateTable
CREATE TABLE "reference_items" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "country" TEXT NOT NULL DEFAULT '',
    "updated_by_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reference_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_access_grants" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "case_ref" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reference_items_kind_code_key" ON "reference_items"("kind", "code");
CREATE INDEX "admin_access_grants_company_id_created_at_idx" ON "admin_access_grants"("company_id", "created_at");
CREATE INDEX "admin_access_grants_admin_id_expires_at_idx" ON "admin_access_grants"("admin_id", "expires_at");

ALTER TABLE "reference_items" ADD CONSTRAINT reference_items_state CHECK (
  kind IN ('PROPERTY_TYPE', 'AMENITY', 'TITLE_DOCUMENT') AND code ~ '^[A-Z][A-Z0-9_]{1,39}$' AND char_length(label) BETWEEN 2 AND 80
  AND (country = '' OR country ~ '^[A-Z]{2}$') AND position BETWEEN 0 AND 1000
);
ALTER TABLE "admin_access_grants" ADD CONSTRAINT admin_access_grants_state CHECK (
  purpose IN ('SUPPORT_REQUEST', 'TRUST_CASE', 'LEGAL_REQUEST', 'BILLING', 'DATA_CORRECTION') AND char_length(note) BETWEEN 10 AND 1000
  AND char_length(case_ref) <= 40 AND expires_at > created_at
);

ALTER TABLE "reference_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reference_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY public_read ON "reference_items" FOR SELECT USING (true);
CREATE POLICY platform_admin ON "reference_items" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

-- Grants: written by platform administrators; the company can read who opened its records, when and why.
ALTER TABLE "admin_access_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admin_access_grants" FORCE ROW LEVEL SECURITY;
CREATE POLICY company_read ON "admin_access_grants" FOR SELECT USING (company_id = app_current_company());
CREATE POLICY platform_admin ON "admin_access_grants" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

-- An agent who deletes their account can remove their own identity checks.
CREATE POLICY owner_delete ON "kyc_items" FOR DELETE USING (subject_kind = 'AGENT' AND subject_user_id = app_current_user());
