-- AlterTable
ALTER TABLE "users" ADD COLUMN "mfa_secret" TEXT,
ADD COLUMN "mfa_enabled_at" TIMESTAMP(3),
ADD COLUMN "mfa_last_step" BIGINT;

-- CreateTable
CREATE TABLE "password_resets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_recoveries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_recoveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "password_resets_token_hash_key" ON "password_resets"("token_hash");

-- CreateIndex
CREATE INDEX "password_resets_user_id_created_at_idx" ON "password_resets"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "mfa_recoveries_user_id_code_hash_key" ON "mfa_recoveries"("user_id", "code_hash");

-- AddForeignKey
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_recoveries" ADD CONSTRAINT "mfa_recoveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Two-step sign-in can only be on when there is a secret.
ALTER TABLE "users" ADD CONSTRAINT "users_mfa_needs_secret" CHECK ("mfa_enabled_at" IS NULL OR "mfa_secret" IS NOT NULL);
-- password_resets and mfa_recoveries are account-level (like sessions), not tenant-owned, and hold only hashes.
