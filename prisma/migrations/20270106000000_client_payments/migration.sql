-- AlterEnum
ALTER TYPE "InvoicePurpose" ADD VALUE 'COMMISSION';

-- AlterEnum
ALTER TYPE "FinanceLedger" ADD VALUE 'COMMISSION';

-- CreateTable
CREATE TABLE "company_payment_settings" (
    "company_id" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL DEFAULT '',
    "bank_code" TEXT NOT NULL DEFAULT '',
    "account_name" TEXT NOT NULL DEFAULT '',
    "account_number" TEXT NOT NULL DEFAULT '',
    "paystack_subaccount" TEXT NOT NULL DEFAULT '',
    "inspection_fee_kobo" BIGINT NOT NULL DEFAULT 0,
    "updated_by_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_payment_settings_pkey" PRIMARY KEY ("company_id")
);

-- CreateTable
CREATE TABLE "client_payments" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "lease_id" TEXT,
    "charge_id" TEXT,
    "booking_id" TEXT,
    "payer_name" TEXT NOT NULL DEFAULT '',
    "payer_email" TEXT NOT NULL DEFAULT '',
    "payer_user_id" TEXT,
    "amount_kobo" BIGINT NOT NULL,
    "commission_bps" INTEGER NOT NULL,
    "commission_kobo" BIGINT NOT NULL,
    "method" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "token_hash" TEXT,
    "checkout_url" TEXT NOT NULL DEFAULT '',
    "paid_at" TIMESTAMP(3),
    "receipt_id" TEXT,
    "recorded_by_id" TEXT,
    "commission_invoice_id" TEXT,
    "cancel_reason" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_payments_ref_key" ON "client_payments"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "client_payments_token_hash_key" ON "client_payments"("token_hash");

-- CreateIndex
CREATE INDEX "client_payments_company_id_status_created_at_idx" ON "client_payments"("company_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "client_payments_charge_id_idx" ON "client_payments"("charge_id");

-- CreateIndex
CREATE INDEX "client_payments_booking_id_idx" ON "client_payments"("booking_id");

-- CreateIndex
CREATE INDEX "client_payments_payer_user_id_idx" ON "client_payments"("payer_user_id");

-- CreateIndex
CREATE INDEX "client_payments_commission_invoice_id_idx" ON "client_payments"("commission_invoice_id");

-- CreateIndex
CREATE INDEX "client_payments_method_status_paid_at_idx" ON "client_payments"("method", "status", "paid_at");



-- ---------- Not generated ----------
-- Payment settings: the company's own; Housy reads them for payment links and settlement.
ALTER TABLE "company_payment_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_payment_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "company_payment_settings" FOR ALL USING (company_id = app_current_company()) WITH CHECK (company_id = app_current_company());
CREATE POLICY platform_admin ON "company_payment_settings" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
ALTER TABLE "company_payment_settings" ADD CONSTRAINT payment_settings_fee CHECK (inspection_fee_kobo >= 0 AND inspection_fee_kobo <= 10000000);

-- Client payments: the company's own; a signed-in payer sees the ones addressed to them; Housy settles and invoices them.
ALTER TABLE "client_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "client_payments" FOR ALL USING (company_id = app_current_company()) WITH CHECK (company_id = app_current_company());
CREATE POLICY payer_read ON "client_payments" FOR SELECT USING (payer_user_id IS NOT NULL AND payer_user_id = app_current_user());
CREATE POLICY platform_admin ON "client_payments" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
ALTER TABLE "client_payments" ADD CONSTRAINT client_payment_values CHECK (
  kind IN ('RENT', 'INSPECTION', 'OTHER') AND status IN ('PENDING', 'PAID', 'CANCELLED') AND method IN ('', 'ONLINE', 'TRANSFER')
  AND amount_kobo > 0 AND commission_bps BETWEEN 0 AND 5000 AND commission_kobo >= 0 AND commission_kobo < amount_kobo
  AND (status <> 'PAID' OR (paid_at IS NOT NULL AND method <> '')));
