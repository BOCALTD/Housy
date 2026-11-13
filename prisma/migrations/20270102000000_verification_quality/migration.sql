-- CreateEnum
CREATE TYPE "VpComplaintStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'UPHELD', 'NOT_UPHELD', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "verification_provider_documents" ADD COLUMN     "expiry_notice" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "verification_cases" ADD COLUMN     "customer_feedback" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "customer_rating" INTEGER;

-- CreateTable
CREATE TABLE "verification_complaints" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "case_id" TEXT,
    "complainant_id" TEXT NOT NULL,
    "by_housy" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "VpComplaintStatus" NOT NULL DEFAULT 'OPEN',
    "provider_response" TEXT NOT NULL DEFAULT '',
    "provider_responder_id" TEXT,
    "provider_responded_at" TIMESTAMP(3),
    "resolution" TEXT NOT NULL DEFAULT '',
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_complaints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "verification_complaints_ref_key" ON "verification_complaints"("ref");

-- CreateIndex
CREATE INDEX "verification_complaints_provider_id_created_at_idx" ON "verification_complaints"("provider_id", "created_at");

-- CreateIndex
CREATE INDEX "verification_complaints_status_created_at_idx" ON "verification_complaints"("status", "created_at");

-- CreateIndex
CREATE INDEX "verification_complaints_complainant_id_idx" ON "verification_complaints"("complainant_id");


-- ---------- Verification network, stage 8: guards and row-level security (not generated) ----------

-- A complaint's facts never change; its status moves only as the rules allow (src/lib/verification-quality-rules.ts);
-- once decided or withdrawn it is final; complaints are never deleted.
CREATE OR REPLACE FUNCTION verification_complaint_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Complaints are never deleted';
  END IF;
  IF NEW.ref <> OLD.ref OR NEW.provider_id <> OLD.provider_id OR NEW.case_id IS DISTINCT FROM OLD.case_id OR NEW.complainant_id <> OLD.complainant_id
     OR NEW.by_housy <> OLD.by_housy OR NEW.category <> OLD.category OR NEW.description <> OLD.description THEN
    RAISE EXCEPTION 'What a complaint says never changes';
  END IF;
  IF OLD.status::text IN ('UPHELD', 'NOT_UPHELD', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'A decided complaint never changes';
  END IF;
  IF NEW.status <> OLD.status AND (OLD.status::text, NEW.status::text) NOT IN (
    ('OPEN','INVESTIGATING'), ('OPEN','UPHELD'), ('OPEN','NOT_UPHELD'), ('OPEN','WITHDRAWN'),
    ('INVESTIGATING','UPHELD'), ('INVESTIGATING','NOT_UPHELD'), ('INVESTIGATING','WITHDRAWN')
  ) THEN
    RAISE EXCEPTION 'A complaint cannot move from % to %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER verification_complaint_guard BEFORE UPDATE OR DELETE ON "verification_complaints" FOR EACH ROW EXECUTE FUNCTION verification_complaint_guard();

-- A customer's rating is from 1 to 5, given once, and only through Housy's service (never by editing the case directly).
CREATE OR REPLACE FUNCTION verification_case_rating_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.customer_rating IS DISTINCT FROM OLD.customer_rating OR NEW.customer_feedback IS DISTINCT FROM OLD.customer_feedback THEN
    IF OLD.customer_rating IS NOT NULL THEN
      RAISE EXCEPTION 'A rating is given once';
    END IF;
    IF NEW.customer_rating IS NULL OR NEW.customer_rating < 1 OR NEW.customer_rating > 5 THEN
      RAISE EXCEPTION 'A rating is from 1 to 5';
    END IF;
    IF NOT app_platform_admin() THEN
      RAISE EXCEPTION 'Ratings are recorded by Housy';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER verification_case_rating_guard BEFORE UPDATE ON "verification_cases" FOR EACH ROW EXECUTE FUNCTION verification_case_rating_guard();

-- Complaints: the person who complained reads theirs; the provider's owner, administrators and managers read those about
-- their organisation; Housy's administrators do everything. Writes go through Housy's services.
ALTER TABLE "verification_complaints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_complaints" FORCE ROW LEVEL SECURITY;
CREATE POLICY complainant_read ON "verification_complaints" FOR SELECT USING (complainant_id = app_current_user() AND NOT by_housy);
CREATE POLICY provider_read ON "verification_complaints" FOR SELECT USING (app_current_user() IS NOT NULL AND app_provider_role(provider_id) IN ('OWNER', 'ADMIN', 'MANAGER'));
CREATE POLICY platform_admin ON "verification_complaints" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

-- Stage 7's ledger account for what is owed to verification providers joins the accounts the books accept.
ALTER TABLE "finance_entries" DROP CONSTRAINT entry_amount;
ALTER TABLE "finance_entries" ADD CONSTRAINT entry_amount CHECK (amount_kobo <> 0 AND account IN ('REVENUE', 'FUNDS_HELD', 'SUSPENSE', 'PROVIDER_PAYABLE'));
