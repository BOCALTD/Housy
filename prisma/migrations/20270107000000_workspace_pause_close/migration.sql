-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "pause_hidden" JSONB,
ADD COLUMN     "suspended_kind" TEXT NOT NULL DEFAULT '';



-- ---------- Not generated ----------
-- Who closed a workspace: Housy (PLATFORM or blank for older rows), or its owner (PAUSED, CLOSED).
ALTER TABLE "companies" ADD CONSTRAINT company_suspended_kind CHECK (suspended_kind IN ('', 'PLATFORM', 'PAUSED', 'CLOSED') AND (suspended_kind = '' OR suspended_at IS NOT NULL));
