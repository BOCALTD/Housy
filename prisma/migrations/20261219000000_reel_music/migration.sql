-- Music on reels: a library of tracks the platform holds a licence for, uploaded by the platform administrator with the
-- licence recorded, and the track, start point and volumes an agent chose for each reel.
CREATE TABLE "music_tracks" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "genre" TEXT NOT NULL DEFAULT '',
    "duration_sec" DOUBLE PRECISION,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "licence_name" TEXT NOT NULL,
    "licence_source" TEXT NOT NULL DEFAULT '',
    "licence_note" TEXT NOT NULL DEFAULT '',
    "credit_required" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "music_tracks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "music_tracks_type_check" CHECK ("mime_type" IN ('audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg') AND "size_bytes" BETWEEN 1 AND 4194304)
);
CREATE INDEX "music_tracks_active_genre_idx" ON "music_tracks"("active", "genre");

CREATE TABLE "music_media" (
    "track_id" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,

    CONSTRAINT "music_media_pkey" PRIMARY KEY ("track_id"),
    CONSTRAINT "music_media_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "music_tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "reels" ADD COLUMN "music_track_id" TEXT;
ALTER TABLE "reels" ADD COLUMN "music_start_sec" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "reels" ADD COLUMN "music_volume" INTEGER NOT NULL DEFAULT 80;
ALTER TABLE "reels" ADD COLUMN "original_volume" INTEGER NOT NULL DEFAULT 40;
ALTER TABLE "reels" ADD COLUMN "music_mixed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "reels" ADD CONSTRAINT "reels_music_track_id_fkey" FOREIGN KEY ("music_track_id") REFERENCES "music_tracks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "reels_music_track_id_idx" ON "reels"("music_track_id");

-- Anyone may see and hear tracks that are switched on; only the platform administrator adds or changes them.
ALTER TABLE "music_tracks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "music_tracks" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_active ON "music_tracks" FOR SELECT USING (active OR app_platform_admin());
CREATE POLICY admin_write ON "music_tracks" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
ALTER TABLE "music_media" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "music_media" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_active ON "music_media" FOR SELECT USING (EXISTS (SELECT 1 FROM music_tracks t WHERE t.id = track_id AND (t.active OR app_platform_admin())));
CREATE POLICY admin_write ON "music_media" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
