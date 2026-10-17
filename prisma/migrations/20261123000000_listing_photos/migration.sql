-- CreateTable
CREATE TABLE "listing_photos" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listing_photos_listing_id_position_idx" ON "listing_photos"("listing_id", "position");

-- AddForeignKey
ALTER TABLE "listing_photos" ADD CONSTRAINT "listing_photos_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "listing_photos" ADD CONSTRAINT listing_photos_state CHECK (
  mime_type IN ('image/png', 'image/jpeg', 'image/webp')
  AND octet_length(bytes) BETWEEN 1 AND 4194304
  AND char_length(caption) <= 200
  AND position BETWEEN 0 AND 30
);

ALTER TABLE "listing_photos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "listing_photos" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "listing_photos" FOR ALL USING (company_id = app_current_company()) WITH CHECK (company_id = app_current_company());
-- Anyone may read the photographs of a published listing (the listing's own public_read policy decides which are published).
CREATE POLICY public_read ON "listing_photos" FOR SELECT USING (EXISTS (SELECT 1 FROM listings l WHERE l.id = listing_photos.listing_id AND l.status = 'PUBLISHED'));
CREATE POLICY platform_admin_read ON "listing_photos" FOR SELECT USING (app_platform_admin());
