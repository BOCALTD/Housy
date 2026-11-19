-- CreateEnum
CREATE TYPE "ContractorPayoutMethod" AS ENUM ('PAYSTACK', 'STRIPE', 'BANK');

-- CreateEnum
CREATE TYPE "ContractorPayoutStatus" AS ENUM ('REQUESTED', 'APPROVED', 'SENDING', 'PAID', 'FAILED', 'REJECTED', 'CANCELLED', 'REVERSED');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "payout_paystack_key" TEXT,
ADD COLUMN     "payout_webhook_token" TEXT;

-- AlterTable
ALTER TABLE "contractors" ADD COLUMN     "account_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "account_number" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "bank_code" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "bank_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "paystack_recipient" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "stripe_account_id" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "stripe_ready" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "contractor_payouts" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "contractor_id" TEXT NOT NULL,
    "work_order_id" TEXT,
    "asset_id" TEXT,
    "amount_kobo" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "method" "ContractorPayoutMethod" NOT NULL,
    "status" "ContractorPayoutStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT NOT NULL,
    "requested_by_id" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT NOT NULL DEFAULT '',
    "provider_ref" TEXT NOT NULL DEFAULT '',
    "transfer_code" TEXT NOT NULL DEFAULT '',
    "checkout_url" TEXT NOT NULL DEFAULT '',
    "bank_reference" TEXT NOT NULL DEFAULT '',
    "paid_on" DATE,
    "paid_at" TIMESTAMP(3),
    "failed_reason" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contractor_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contractor_payout_events" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "payout_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "from_status" "ContractorPayoutStatus",
    "to_status" "ContractorPayoutStatus",
    "note" TEXT NOT NULL DEFAULT '',
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contractor_payout_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contractor_payouts_company_id_status_created_at_idx" ON "contractor_payouts"("company_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "contractor_payouts_status_updated_at_idx" ON "contractor_payouts"("status", "updated_at");

-- CreateIndex
CREATE INDEX "contractor_payouts_work_order_id_idx" ON "contractor_payouts"("work_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "contractor_payouts_company_id_ref_key" ON "contractor_payouts"("company_id", "ref");

-- CreateIndex
CREATE INDEX "contractor_payout_events_company_id_payout_id_idx" ON "contractor_payout_events"("company_id", "payout_id");

-- CreateIndex
CREATE UNIQUE INDEX "companies_payout_webhook_token_key" ON "companies"("payout_webhook_token");

-- AddForeignKey
ALTER TABLE "contractor_payouts" ADD CONSTRAINT "contractor_payouts_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_payout_events" ADD CONSTRAINT "contractor_payout_events_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "contractor_payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "contractor_payouts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contractor_payouts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "contractor_payouts" FOR ALL USING (company_id = app_current_company()) WITH CHECK (company_id = app_current_company());
-- The scheduled check finds transfers still being sent across companies (and nothing else).
CREATE POLICY admin_read ON "contractor_payouts" FOR SELECT USING (app_platform_admin());
ALTER TABLE "contractor_payout_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contractor_payout_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON "contractor_payout_events" FOR SELECT USING (company_id = app_current_company());
CREATE POLICY tenant_insert ON "contractor_payout_events" FOR INSERT WITH CHECK (company_id = app_current_company());

-- Two people: whoever approved or rejected a payment did not ask for it. Paid means decided, with a date.
ALTER TABLE "contractor_payouts" ADD CONSTRAINT "contractor_payouts_two_people" CHECK (decided_by_id IS NULL OR decided_by_id <> requested_by_id);
ALTER TABLE "contractor_payouts" ADD CONSTRAINT "contractor_payouts_decided" CHECK (status IN ('REQUESTED', 'CANCELLED') OR (decided_by_id IS NOT NULL AND decided_at IS NOT NULL));
ALTER TABLE "contractor_payouts" ADD CONSTRAINT "contractor_payouts_paid" CHECK (status NOT IN ('PAID', 'REVERSED') OR (paid_on IS NOT NULL AND paid_at IS NOT NULL));
ALTER TABLE "contractor_payouts" ADD CONSTRAINT "contractor_payouts_amount" CHECK (amount_kobo > 0 AND char_length(btrim(reason)) BETWEEN 3 AND 300);
ALTER TABLE "contractor_payouts" ADD CONSTRAINT "contractor_payouts_bank_ref" CHECK (method <> 'BANK' OR status <> 'PAID' OR char_length(bank_reference) >= 4);

-- What was asked for and approved cannot be changed afterwards: only its progress.
CREATE FUNCTION contractor_payout_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.company_id <> OLD.company_id OR NEW.ref <> OLD.ref OR NEW.contractor_id <> OLD.contractor_id OR NEW.amount_kobo <> OLD.amount_kobo
     OR NEW.currency <> OLD.currency OR NEW.method <> OLD.method OR NEW.requested_by_id <> OLD.requested_by_id OR NEW.provider_ref <> OLD.provider_ref
     OR NEW.work_order_id IS DISTINCT FROM OLD.work_order_id THEN
    RAISE EXCEPTION 'A payment request cannot be changed; cancel it and ask again' USING ERRCODE = '23514';
  END IF;
  IF OLD.status IN ('PAID', 'REJECTED', 'CANCELLED', 'FAILED') AND NOT (OLD.status = 'PAID' AND NEW.status = 'REVERSED') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'A finished payment cannot change' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contractor_payout_fixed BEFORE UPDATE ON contractor_payouts FOR EACH ROW EXECUTE FUNCTION contractor_payout_fixed();
