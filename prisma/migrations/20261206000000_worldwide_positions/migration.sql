-- Properties can be anywhere in the world now (the map opens on the visitor's country), so the
-- position checks only require a real latitude and longitude instead of a box around Nigeria.
ALTER TABLE "assets" DROP CONSTRAINT IF EXISTS assets_position;
ALTER TABLE "listings" DROP CONSTRAINT IF EXISTS listings_position;
ALTER TABLE "assets" ADD CONSTRAINT assets_position CHECK ((lat IS NULL) = (lng IS NULL) AND (lat IS NULL OR (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180)));
ALTER TABLE "listings" ADD CONSTRAINT listings_position CHECK ((lat IS NULL) = (lng IS NULL) AND (lat IS NULL OR (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180)));
