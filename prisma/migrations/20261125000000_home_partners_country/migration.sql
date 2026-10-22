-- AlterTable
ALTER TABLE "listings" ADD COLUMN "country" TEXT NOT NULL DEFAULT 'NG';
ALTER TABLE "listings" ADD CONSTRAINT listings_country_code CHECK (country ~ '^[A-Z]{2}$');

-- CreateTable
CREATE TABLE "partners" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL DEFAULT '',
    "blurb" TEXT NOT NULL DEFAULT '',
    "logo_mime" TEXT,
    "logo_bytes" BYTEA,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "added_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "partners" ADD CONSTRAINT partners_state CHECK (
  char_length(name) BETWEEN 2 AND 120
  AND kind IN ('BANK', 'LAW_FIRM', 'SURVEYOR', 'VALUER', 'DEVELOPER', 'INSURER', 'MEDIA', 'TECHNOLOGY', 'ASSOCIATION', 'OTHER')
  AND (url = '' OR url ~ '^https://')
  AND char_length(url) <= 300
  AND char_length(blurb) <= 300
  AND ((logo_mime IS NULL AND logo_bytes IS NULL) OR (logo_mime IN ('image/png', 'image/jpeg', 'image/webp') AND octet_length(logo_bytes) BETWEEN 1 AND 1048576))
  AND position BETWEEN 0 AND 1000
);

-- Partners are platform records (no company). Everyone may see active ones; only platform administrators change them.
ALTER TABLE "partners" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "partners" FORCE ROW LEVEL SECURITY;
CREATE POLICY public_read ON "partners" FOR SELECT USING (active);
CREATE POLICY platform_admin ON "partners" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
