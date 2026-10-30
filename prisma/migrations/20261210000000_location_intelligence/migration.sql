-- Location intelligence: estate and site outlines, the exact meeting position for confirmed inspections, and a shared cache of
-- nearby places (schools, hospitals, markets and so on) looked up from OpenStreetMap.

-- A site outline drawn by the company. The listing carries a copy only when the company chose to show it publicly.
ALTER TABLE "assets" ADD COLUMN "boundary" JSONB;
ALTER TABLE "assets" ADD COLUMN "boundary_public" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "listings" ADD COLUMN "boundary" JSONB;
ALTER TABLE "assets" ADD CONSTRAINT assets_boundary CHECK (boundary IS NULL OR (jsonb_typeof(boundary) = 'array' AND jsonb_array_length(boundary) BETWEEN 3 AND 60));
ALTER TABLE "listings" ADD CONSTRAINT listings_boundary CHECK (boundary IS NULL OR (jsonb_typeof(boundary) = 'array' AND jsonb_array_length(boundary) BETWEEN 3 AND 60));
ALTER TABLE "assets" ADD CONSTRAINT assets_boundary_public CHECK (NOT boundary_public OR boundary IS NOT NULL);

-- Where to meet for a confirmed inspection: the property's own position, given to the person only once the time is confirmed.
ALTER TABLE "inspection_bookings" ADD COLUMN "meet_lat" DOUBLE PRECISION;
ALTER TABLE "inspection_bookings" ADD COLUMN "meet_lng" DOUBLE PRECISION;
ALTER TABLE "inspection_bookings" ADD CONSTRAINT inspection_bookings_meet CHECK ((meet_lat IS NULL) = (meet_lng IS NULL) AND (meet_lat IS NULL OR (meet_lat BETWEEN -90 AND 90 AND meet_lng BETWEEN -180 AND 180)));

-- Nearby places by map cell (about a square kilometre). Public map data only; kept for 30 days, failed lookups for 1 hour.
-- Like rate_limits it is platform-level and holds nothing about any person or company, so it has no row-level security.
CREATE TABLE "nearby_cache" (
    "cell" TEXT NOT NULL,
    "places" JSONB NOT NULL DEFAULT '[]',
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "nearby_cache_pkey" PRIMARY KEY ("cell")
);
ALTER TABLE "nearby_cache" ADD CONSTRAINT nearby_cache_cell CHECK (cell ~ '^-?[0-9]{1,2}\.[0-9]{2},-?[0-9]{1,3}\.[0-9]{2}$' AND jsonb_typeof(places) = 'array');
