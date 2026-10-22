-- Listing details (master prompt §7): type, price period, costs, sizes, condition, amenities, stated documents, availability.
ALTER TABLE "listings" ADD COLUMN "property_type" TEXT NOT NULL DEFAULT 'OTHER',
ADD COLUMN "price_period" TEXT NOT NULL DEFAULT 'TOTAL',
ADD COLUMN "negotiable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "deposit_kobo" BIGINT,
ADD COLUMN "service_charge_kobo" BIGINT,
ADD COLUMN "fees_note" TEXT NOT NULL DEFAULT '',
ADD COLUMN "toilets" INTEGER,
ADD COLUMN "floors" INTEGER,
ADD COLUMN "building_sqm" INTEGER,
ADD COLUMN "land_sqm" INTEGER,
ADD COLUMN "plot_dimensions" TEXT NOT NULL DEFAULT '',
ADD COLUMN "furnishing" TEXT NOT NULL DEFAULT 'UNSPECIFIED',
ADD COLUMN "condition" TEXT NOT NULL DEFAULT 'UNSPECIFIED',
ADD COLUMN "construction_status" TEXT NOT NULL DEFAULT 'COMPLETED',
ADD COLUMN "serviced" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "amenities" TEXT NOT NULL DEFAULT '',
ADD COLUMN "title_document" TEXT NOT NULL DEFAULT 'UNSPECIFIED',
ADD COLUMN "available_from" DATE,
ADD COLUMN "min_lease_months" INTEGER,
ADD COLUMN "estate_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN "video_url" TEXT NOT NULL DEFAULT '';

-- Existing rent and lease listings were yearly prices.
UPDATE "listings" SET "price_period" = 'YEAR' WHERE "purpose" <> 'SALE';

ALTER TABLE "listings" ADD CONSTRAINT listings_details CHECK (
  property_type IN ('HOUSE', 'DUPLEX', 'SEMI_DETACHED', 'TERRACE', 'BUNGALOW', 'FLAT', 'PENTHOUSE', 'MAISONETTE', 'SELF_CONTAINED', 'ROOM', 'SHARED_ROOM', 'LAND', 'OFFICE', 'SHOP', 'PLAZA', 'HOTEL', 'EVENT_CENTRE', 'WAREHOUSE', 'INDUSTRIAL', 'FILLING_STATION', 'FARM', 'PLANT_MACHINERY', 'OTHER')
  AND price_period IN ('TOTAL', 'YEAR', 'MONTH', 'NIGHT')
  AND (purpose = 'SALE') = (price_period = 'TOTAL')
  AND furnishing IN ('UNSPECIFIED', 'FURNISHED', 'SEMI_FURNISHED', 'UNFURNISHED')
  AND condition IN ('UNSPECIFIED', 'NEW', 'RENOVATED', 'GOOD', 'FAIR', 'NEEDS_WORK')
  AND construction_status IN ('COMPLETED', 'UNDER_CONSTRUCTION', 'OFF_PLAN')
  AND title_document IN ('UNSPECIFIED', 'C_OF_O', 'R_OF_O', 'GOVERNORS_CONSENT', 'DEED_OF_ASSIGNMENT', 'REGISTERED_SURVEY', 'GAZETTE', 'EXCISION', 'LETTER_OF_ALLOCATION', 'CONTRACT_OF_SALE', 'LEASE_AGREEMENT', 'OTHER')
  AND amenities ~ '^((SECURITY|GATED|CCTV|FENCED|PARKING|POWER_PUBLIC|PREPAID_METER|GENERATOR|SOLAR|WATER|BOREHOLE|INTERNET|AIR_CON|FITTED_KITCHEN|WARDROBES|BOYS_QUARTERS|BALCONY|GARDEN|POOL|GYM|ELEVATOR|TARRED_ROAD|DRAINAGE|LOADING_BAY|PET_FRIENDLY|ACCESSIBLE)(,(SECURITY|GATED|CCTV|FENCED|PARKING|POWER_PUBLIC|PREPAID_METER|GENERATOR|SOLAR|WATER|BOREHOLE|INTERNET|AIR_CON|FITTED_KITCHEN|WARDROBES|BOYS_QUARTERS|BALCONY|GARDEN|POOL|GYM|ELEVATOR|TARRED_ROAD|DRAINAGE|LOADING_BAY|PET_FRIENDLY|ACCESSIBLE))*)?$'
  AND (deposit_kobo IS NULL OR deposit_kobo >= 0) AND (service_charge_kobo IS NULL OR service_charge_kobo >= 0)
  AND (toilets IS NULL OR toilets BETWEEN 0 AND 99) AND (floors IS NULL OR floors BETWEEN 0 AND 200)
  AND (building_sqm IS NULL OR building_sqm BETWEEN 1 AND 10000000) AND (land_sqm IS NULL OR land_sqm BETWEEN 1 AND 100000000)
  AND (min_lease_months IS NULL OR min_lease_months BETWEEN 1 AND 1200)
  AND char_length(fees_note) <= 500 AND char_length(plot_dimensions) <= 60 AND char_length(estate_name) <= 120
  AND (video_url = '' OR video_url ~ '^https://(www\.)?(youtube\.com|youtu\.be|vimeo\.com)/')
);

CREATE INDEX "listings_status_property_type_idx" ON "listings"("status", "property_type");

-- Floor plans are stored with the photographs.
ALTER TABLE "listing_photos" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'PHOTO';
ALTER TABLE "listing_photos" ADD CONSTRAINT listing_photos_kind CHECK (kind IN ('PHOTO', 'FLOOR_PLAN'));
