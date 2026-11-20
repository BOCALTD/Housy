-- "Confirm it's you" for sensitive areas: when this session last confirmed the password, and wrong tries since.
ALTER TABLE "sessions" ADD COLUMN     "reauth_at" TIMESTAMP(3),
ADD COLUMN     "reauth_fails" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "sessions" ADD CONSTRAINT sessions_reauth_fails CHECK (reauth_fails BETWEEN 0 AND 10);
