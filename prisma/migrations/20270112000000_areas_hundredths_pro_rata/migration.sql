-- Areas move from whole square metres to hundredths (12050 = 120.5 m²). The columns are renamed and their values multiplied
-- by 100, so nothing is lost; the size checks are widened to match.
SELECT set_config('app.platform_admin', 'on', false);

-- AlterTable
ALTER TABLE "leases" DROP CONSTRAINT "leases_floor_area_positive";
ALTER TABLE "leases" RENAME COLUMN "floor_area_sqm" TO "floor_area_sqm100";
UPDATE "leases" SET "floor_area_sqm100" = "floor_area_sqm100" * 100 WHERE "floor_area_sqm100" IS NOT NULL;
ALTER TABLE "leases" ADD CONSTRAINT "leases_floor_area_positive" CHECK ("floor_area_sqm100" IS NULL OR "floor_area_sqm100" BETWEEN 1 AND 1000000000);

-- AlterTable
ALTER TABLE "listings" DROP CONSTRAINT listings_details;
ALTER TABLE "listings" RENAME COLUMN "building_sqm" TO "building_sqm100";
ALTER TABLE "listings" RENAME COLUMN "land_sqm" TO "land_sqm100";
UPDATE "listings" SET "building_sqm100" = "building_sqm100" * 100 WHERE "building_sqm100" IS NOT NULL;
UPDATE "listings" SET "land_sqm100" = LEAST("land_sqm100"::bigint * 100, 2000000000)::int WHERE "land_sqm100" IS NOT NULL;
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
  AND (building_sqm100 IS NULL OR building_sqm100 BETWEEN 1 AND 1000000000) AND (land_sqm100 IS NULL OR land_sqm100 BETWEEN 1 AND 2000000000)
  AND (min_lease_months IS NULL OR min_lease_months BETWEEN 1 AND 1200)
  AND char_length(fees_note) <= 500 AND char_length(plot_dimensions) <= 60 AND char_length(estate_name) <= 120
  AND (video_url = '' OR video_url ~ '^https://(www\.)?(youtube\.com|youtu\.be|vimeo\.com)/')
);

-- AlterTable
ALTER TABLE "service_assessments" ADD COLUMN     "days_occupied" INTEGER,
ADD COLUMN     "period_days" INTEGER;
ALTER TABLE "service_assessments" ADD CONSTRAINT service_assessment_days CHECK ((days_occupied IS NULL) = (period_days IS NULL) AND (days_occupied IS NULL OR (days_occupied BETWEEN 1 AND period_days AND period_days BETWEEN 1 AND 3700)));

SELECT set_config('app.platform_admin', '', false);
