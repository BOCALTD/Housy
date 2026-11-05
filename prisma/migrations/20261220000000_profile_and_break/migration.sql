-- Profile photo and cover photo (kept apart from users so sign-in never loads pictures), a short bio, and "take a break".
ALTER TABLE "users" ADD COLUMN "bio" TEXT NOT NULL DEFAULT '';
ALTER TABLE "users" ADD COLUMN "break_started_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "break_until" TIMESTAMP(3);

CREATE TABLE "user_media" (
    "user_id" TEXT NOT NULL,
    "avatar" BYTEA,
    "avatar_type" TEXT,
    "cover" BYTEA,
    "cover_type" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_media_pkey" PRIMARY KEY ("user_id")
);
ALTER TABLE "user_media" ADD CONSTRAINT "user_media_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
