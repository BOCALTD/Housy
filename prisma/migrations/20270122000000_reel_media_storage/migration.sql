-- AlterTable
ALTER TABLE "reels" ADD COLUMN     "duration_sec" DOUBLE PRECISION,
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "media_key" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "music_pending" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "poster_key" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "process_error" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "process_started_at" TIMESTAMP(3),
ADD COLUMN     "process_tries" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "processing" TEXT NOT NULL DEFAULT 'ready',
ADD COLUMN     "storage" TEXT NOT NULL DEFAULT 'db',
ADD COLUMN     "width" INTEGER;

-- CreateTable
CREATE TABLE "reel_posters" (
    "reel_id" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,

    CONSTRAINT "reel_posters_pkey" PRIMARY KEY ("reel_id")
);

-- CreateTable
CREATE TABLE "reel_uploads" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_name" TEXT NOT NULL DEFAULT '',
    "total_bytes" INTEGER NOT NULL,
    "received_bytes" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),

    CONSTRAINT "reel_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reel_uploads_user_id_created_at_idx" ON "reel_uploads"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "reel_uploads_expires_at_idx" ON "reel_uploads"("expires_at");

-- CreateIndex
CREATE INDEX "reels_processing_created_at_idx" ON "reels"("processing", "created_at");


-- Larger clips (sent in pieces, prepared by ffmpeg), iPhone MOV until prepared, and where each is kept.
ALTER TABLE "reels" DROP CONSTRAINT reel_media_type;
ALTER TABLE "reels" ADD CONSTRAINT reel_media_type CHECK (mime_type IN ('video/mp4', 'video/webm', 'video/quicktime') AND size_bytes BETWEEN 1 AND 104857600);
ALTER TABLE "reels" ADD CONSTRAINT reel_storage CHECK (storage IN ('db', 'disk', 's3') AND (storage = 'db' OR media_key <> ''));
ALTER TABLE "reels" ADD CONSTRAINT reel_processing CHECK (processing IN ('queued', 'processing', 'ready', 'failed'));

-- The prepared clip replaces the original in the database.
CREATE POLICY admin_update ON "reel_media" FOR UPDATE USING (app_platform_admin()) WITH CHECK (app_platform_admin());
CREATE POLICY admin_delete ON "reel_media" FOR DELETE USING (app_platform_admin());

ALTER TABLE "reel_posters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reel_posters" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_scope ON "reel_posters" FOR SELECT USING (EXISTS (SELECT 1 FROM reels r WHERE r.id = reel_id));
CREATE POLICY admin_write ON "reel_posters" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "reel_uploads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reel_uploads" FORCE ROW LEVEL SECURITY;
CREATE POLICY own_read ON "reel_uploads" FOR SELECT USING (user_id = app_current_user() OR app_platform_admin());
CREATE POLICY admin_write ON "reel_uploads" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
ALTER TABLE "reel_uploads" ADD CONSTRAINT reel_upload_bytes CHECK (total_bytes BETWEEN 1 AND 104857600 AND received_bytes BETWEEN 0 AND total_bytes);
