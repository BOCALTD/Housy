-- AlterTable
ALTER TABLE "users" ADD COLUMN     "removed_at" TIMESTAMP(3),
ADD COLUMN     "suspended_at" TIMESTAMP(3),
ADD COLUMN     "suspended_by_id" TEXT,
ADD COLUMN     "suspended_reason" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "blocked_identities" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value_hash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "user_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocked_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "blocked_identities_value_hash_key" ON "blocked_identities"("value_hash");


-- ---------- Not generated ----------
-- Blocked identities: only Housy (an administrator or the system) reads or writes them. Rows are never changed or deleted
-- by the runtime role (see scripts/db-setup.mjs APPEND_ONLY), so a removal cannot be quietly undone.
ALTER TABLE "blocked_identities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "blocked_identities" FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_admin ON "blocked_identities" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
ALTER TABLE "users" ADD CONSTRAINT users_suspension_reason CHECK (suspended_at IS NULL OR length(btrim(suspended_reason)) >= 10);
