-- Listing risk checks (master prompt §37): a fingerprint of each listing photo, so a photo another company already uses can be
-- spotted when a listing is reviewed. Filled by the database itself, for every photo old and new.
ALTER TABLE "listing_photos" ADD COLUMN "content_hash" TEXT;
UPDATE "listing_photos" SET "content_hash" = encode(sha256("bytes"), 'hex');

CREATE OR REPLACE FUNCTION listing_photo_hash() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.content_hash := encode(sha256(NEW.bytes), 'hex');
  RETURN NEW;
END $$;
CREATE TRIGGER listing_photo_hash BEFORE INSERT OR UPDATE OF bytes ON "listing_photos" FOR EACH ROW EXECUTE FUNCTION listing_photo_hash();
GRANT EXECUTE ON FUNCTION listing_photo_hash() TO PUBLIC;

CREATE INDEX "listing_photos_content_hash_idx" ON "listing_photos"("content_hash");
