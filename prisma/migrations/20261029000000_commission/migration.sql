-- CreateEnum
CREATE TYPE "CommissionMethod" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "CommissionApplies" AS ENUM ('ALL', 'SALE', 'RENT', 'LEASE');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'PAID');

-- CreateEnum
CREATE TYPE "SplitRole" AS ENUM ('LISTING_AGENT', 'SELLING_AGENT', 'TEAM_LEAD', 'REFERRAL', 'OTHER');

-- CreateTable
CREATE TABLE "commission_rules" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "applies" "CommissionApplies" NOT NULL DEFAULT 'ALL',
    "method" "CommissionMethod" NOT NULL,
    "rate_bps" INTEGER,
    "fixed_kobo" BIGINT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_commissions" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "rule_name" TEXT NOT NULL,
    "method" "CommissionMethod" NOT NULL,
    "rate_bps" INTEGER,
    "fixed_kobo" BIGINT,
    "basis_kobo" BIGINT NOT NULL,
    "total_kobo" BIGINT NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submitted_by_id" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT NOT NULL DEFAULT '',
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deal_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_splits" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "commission_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "role" "SplitRole" NOT NULL,
    "share_bps" INTEGER NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "paid_at" TIMESTAMP(3),
    "paid_by_id" TEXT,
    "pay_reference" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_splits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "commission_rules_company_id_name_key" ON "commission_rules"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "deal_commissions_deal_id_key" ON "deal_commissions"("deal_id");

-- CreateIndex
CREATE INDEX "deal_commissions_company_id_status_idx" ON "deal_commissions"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "commission_splits_commission_id_membership_id_key" ON "commission_splits"("commission_id", "membership_id");

-- CreateIndex
CREATE INDEX "commission_splits_company_id_membership_id_idx" ON "commission_splits"("company_id", "membership_id");

-- AddForeignKey
ALTER TABLE "deal_commissions" ADD CONSTRAINT "deal_commissions_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_splits" ADD CONSTRAINT "commission_splits_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "deal_commissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "commission_rules" ADD CONSTRAINT commission_rules_name_present CHECK (length(btrim(name)) >= 2);
ALTER TABLE "commission_rules" ADD CONSTRAINT commission_rules_figures CHECK (
  (method = 'PERCENT' AND rate_bps BETWEEN 1 AND 10000 AND fixed_kobo IS NULL) OR (method = 'FIXED' AND fixed_kobo > 0 AND rate_bps IS NULL)
);
ALTER TABLE "deal_commissions" ADD CONSTRAINT deal_commissions_figures CHECK (
  basis_kobo > 0 AND total_kobo >= 0 AND
  ((method = 'PERCENT' AND rate_bps BETWEEN 1 AND 10000 AND fixed_kobo IS NULL) OR (method = 'FIXED' AND fixed_kobo > 0 AND rate_bps IS NULL))
);
ALTER TABLE "deal_commissions" ADD CONSTRAINT deal_commissions_second_person CHECK (status NOT IN ('APPROVED', 'PAID') OR (decided_by_id IS NOT NULL AND decided_by_id <> submitted_by_id));
ALTER TABLE "deal_commissions" ADD CONSTRAINT deal_commissions_rejection_reason CHECK (status <> 'REJECTED' OR length(btrim(decision_note)) >= 3);
ALTER TABLE "deal_commissions" ADD CONSTRAINT deal_commissions_paid_dated CHECK (status <> 'PAID' OR paid_at IS NOT NULL);
ALTER TABLE "commission_splits" ADD CONSTRAINT commission_splits_share CHECK (share_bps BETWEEN 1 AND 10000);
ALTER TABLE "commission_splits" ADD CONSTRAINT commission_splits_amount CHECK (amount_kobo >= 0);
ALTER TABLE "commission_splits" ADD CONSTRAINT commission_splits_paid_by CHECK ((paid_at IS NULL) = (paid_by_id IS NULL));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['commission_rules','deal_commissions','commission_splits']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL
                      USING (company_id = app_current_company())
                      WITH CHECK (company_id = app_current_company())', t);
  END LOOP;
END $$;

-- A completed deal can be disputed afterwards: the stage stays "completed" while the status becomes "disputed".
ALTER TABLE "deals" DROP CONSTRAINT deals_completed_matches_stage;
ALTER TABLE "deals" ADD CONSTRAINT deals_completed_matches_stage CHECK ((status <> 'COMPLETED' OR stage = 'COMPLETED') AND (stage <> 'COMPLETED' OR status IN ('COMPLETED', 'DISPUTED')));
ALTER TABLE "deals" DROP CONSTRAINT deals_completed_has_who;
ALTER TABLE "deals" ADD CONSTRAINT deals_completed_has_who CHECK (stage <> 'COMPLETED' OR (completed_at IS NOT NULL AND completed_by_id IS NOT NULL));
