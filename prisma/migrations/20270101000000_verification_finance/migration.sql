-- CreateEnum
CREATE TYPE "VpEarningStatus" AS ENUM ('PENDING', 'HELD', 'PAYABLE', 'IN_PAYOUT', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "VpPayoutStatus" AS ENUM ('PREPARED', 'PAID', 'CANCELLED');

-- AlterEnum
ALTER TYPE "InvoicePurpose" ADD VALUE 'VERIFICATION';

-- AlterEnum
ALTER TYPE "FinanceLedger" ADD VALUE 'VERIFICATION';

-- AlterTable
ALTER TABLE "service_providers" ADD COLUMN     "payout_account_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "payout_account_number" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "payout_bank_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "payout_updated_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "verification_cases" ADD COLUMN     "fee_kobo" BIGINT,
ADD COLUMN     "invoice_id" TEXT,
ADD COLUMN     "price_kobo" BIGINT;

-- CreateTable
CREATE TABLE "verification_earnings" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "gross_kobo" BIGINT NOT NULL,
    "fee_kobo" BIGINT NOT NULL,
    "net_kobo" BIGINT NOT NULL,
    "status" "VpEarningStatus" NOT NULL DEFAULT 'PENDING',
    "held_reason" TEXT NOT NULL DEFAULT '',
    "payable_from" TIMESTAMP(3),
    "recognised_at" TIMESTAMP(3),
    "payout_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_earnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_payouts" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "total_kobo" BIGINT NOT NULL,
    "status" "VpPayoutStatus" NOT NULL DEFAULT 'PREPARED',
    "bank_name" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "transfer_reference" TEXT NOT NULL DEFAULT '',
    "prepared_by_id" TEXT NOT NULL,
    "prepared_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_by_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "cancelled_by_id" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "verification_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "verification_earnings_case_id_key" ON "verification_earnings"("case_id");

-- CreateIndex
CREATE INDEX "verification_earnings_provider_id_status_idx" ON "verification_earnings"("provider_id", "status");

-- CreateIndex
CREATE INDEX "verification_earnings_status_payable_from_idx" ON "verification_earnings"("status", "payable_from");

-- CreateIndex
CREATE UNIQUE INDEX "verification_payouts_ref_key" ON "verification_payouts"("ref");

-- CreateIndex
CREATE INDEX "verification_payouts_provider_id_prepared_at_idx" ON "verification_payouts"("provider_id", "prepared_at");

-- CreateIndex
CREATE INDEX "verification_payouts_status_idx" ON "verification_payouts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "verification_cases_invoice_id_key" ON "verification_cases"("invoice_id");

-- AddForeignKey
ALTER TABLE "verification_earnings" ADD CONSTRAINT "verification_earnings_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "verification_payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Verification network, stage 7: guards and row-level security (not generated) ----------

-- An earning's amounts and case never change; its status moves only as the rules allow (src/lib/verification-finance-rules.ts);
-- it is never deleted.
CREATE OR REPLACE FUNCTION verification_earning_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Earnings are never deleted';
  END IF;
  IF NEW.case_id <> OLD.case_id OR NEW.provider_id <> OLD.provider_id OR NEW.invoice_id <> OLD.invoice_id
     OR NEW.gross_kobo <> OLD.gross_kobo OR NEW.fee_kobo <> OLD.fee_kobo OR NEW.net_kobo <> OLD.net_kobo THEN
    RAISE EXCEPTION 'An earning''s amounts never change';
  END IF;
  IF OLD.recognised_at IS NOT NULL AND NEW.recognised_at IS DISTINCT FROM OLD.recognised_at THEN
    RAISE EXCEPTION 'An earning is recognised once';
  END IF;
  IF NEW.status <> OLD.status AND (OLD.status::text, NEW.status::text) NOT IN (
    ('PENDING','PAYABLE'), ('PENDING','HELD'), ('PENDING','VOID'),
    ('HELD','PENDING'), ('HELD','PAYABLE'), ('HELD','VOID'),
    ('PAYABLE','HELD'), ('PAYABLE','IN_PAYOUT'),
    ('IN_PAYOUT','PAYABLE'), ('IN_PAYOUT','PAID')
  ) THEN
    RAISE EXCEPTION 'An earning cannot move from % to %', OLD.status, NEW.status;
  END IF;
  IF NEW.status = 'IN_PAYOUT' AND NEW.payout_id IS NULL THEN
    RAISE EXCEPTION 'An earning in a payout must name the payout';
  END IF;
  IF NEW.status IN ('PAYABLE', 'IN_PAYOUT', 'PAID') AND NEW.recognised_at IS NULL THEN
    RAISE EXCEPTION 'An earning must be recognised in the books before it can be paid';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER verification_earning_guard BEFORE UPDATE OR DELETE ON "verification_earnings" FOR EACH ROW EXECUTE FUNCTION verification_earning_guard();

-- A payout is prepared, then paid or cancelled, once. A paid or cancelled payout never changes; payouts are never deleted.
CREATE OR REPLACE FUNCTION verification_payout_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payouts are never deleted';
  END IF;
  IF OLD.status <> 'PREPARED' THEN
    RAISE EXCEPTION 'A % payout never changes', lower(OLD.status::text);
  END IF;
  IF NEW.ref <> OLD.ref OR NEW.provider_id <> OLD.provider_id OR NEW.total_kobo <> OLD.total_kobo OR NEW.bank_name <> OLD.bank_name
     OR NEW.account_name <> OLD.account_name OR NEW.account_number <> OLD.account_number THEN
    RAISE EXCEPTION 'A payout''s amount and bank account never change';
  END IF;
  IF NEW.status = 'PAID' AND (length(trim(NEW.transfer_reference)) < 3 OR NEW.paid_by_id IS NULL OR NEW.paid_at IS NULL) THEN
    RAISE EXCEPTION 'A paid payout needs the transfer reference, who recorded it and when';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER verification_payout_guard BEFORE UPDATE OR DELETE ON "verification_payouts" FOR EACH ROW EXECUTE FUNCTION verification_payout_guard();

-- The price and fee of a case are fixed once quoted.
CREATE OR REPLACE FUNCTION verification_case_price_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.price_kobo IS NOT NULL AND NEW.price_kobo IS DISTINCT FROM OLD.price_kobo)
     OR (OLD.fee_kobo IS NOT NULL AND NEW.fee_kobo IS DISTINCT FROM OLD.fee_kobo)
     OR (OLD.invoice_id IS NOT NULL AND NEW.invoice_id IS DISTINCT FROM OLD.invoice_id) THEN
    RAISE EXCEPTION 'A case''s price is fixed once it has been quoted';
  END IF;
  IF (NEW.price_kobo IS DISTINCT FROM OLD.price_kobo OR NEW.fee_kobo IS DISTINCT FROM OLD.fee_kobo OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id) AND NOT app_platform_admin() THEN
    RAISE EXCEPTION 'Only Housy quotes a case';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER verification_case_price_guard BEFORE UPDATE ON "verification_cases" FOR EACH ROW EXECUTE FUNCTION verification_case_price_guard();

-- Earnings and payouts: the provider's owner and finance staff read their own; only Housy writes.
ALTER TABLE "verification_earnings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_earnings" FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_finance_read ON "verification_earnings" FOR SELECT USING (app_current_user() IS NOT NULL AND app_provider_role(provider_id) IN ('OWNER', 'FINANCE'));
CREATE POLICY platform_admin ON "verification_earnings" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "verification_payouts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_payouts" FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_finance_read ON "verification_payouts" FOR SELECT USING (app_current_user() IS NOT NULL AND app_provider_role(provider_id) IN ('OWNER', 'FINANCE'));
CREATE POLICY platform_admin ON "verification_payouts" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
