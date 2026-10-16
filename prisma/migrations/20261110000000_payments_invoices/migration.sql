-- CreateEnum
CREATE TYPE "BillingInvoiceStatus" AS ENUM ('OPEN', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "InvoicePurpose" AS ENUM ('SUBSCRIPTION', 'AD_CAMPAIGN');

-- CreateEnum
CREATE TYPE "PaymentProviderKind" AS ENUM ('PAYSTACK', 'MANUAL');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REVIEW');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "FinanceLedger" AS ENUM ('SUBSCRIPTION', 'ADVERTISING');

-- CreateEnum
CREATE TYPE "FinanceEntryKind" AS ENUM ('PAYMENT', 'REFUND', 'SPEND', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "purpose" "InvoicePurpose" NOT NULL,
    "owner_kind" "SubscriptionOwner" NOT NULL,
    "owner_user_id" TEXT,
    "owner_company_id" TEXT,
    "owner_name" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "period_months" INTEGER NOT NULL DEFAULT 0,
    "renewal" BOOLEAN NOT NULL DEFAULT false,
    "reminder_stage" TEXT NOT NULL DEFAULT '',
    "status" "BillingInvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "due_on" TIMESTAMP(3),
    "applied_at" TIMESTAMP(3),
    "previous_end" TIMESTAMP(3),
    "covers_to" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "provider" "PaymentProviderKind" NOT NULL,
    "provider_ref" TEXT,
    "provider_tx_id" TEXT NOT NULL DEFAULT '',
    "amount_kobo" BIGINT NOT NULL,
    "received_kobo" BIGINT,
    "refunded_kobo" BIGINT NOT NULL DEFAULT 0,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "failure_reason" TEXT NOT NULL DEFAULT '',
    "review_note" TEXT NOT NULL DEFAULT '',
    "checkout_url" TEXT NOT NULL DEFAULT '',
    "initiated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMP(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProviderKind" NOT NULL,
    "event_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reference" TEXT NOT NULL DEFAULT '',
    "amount_kobo" BIGINT,
    "outcome" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "payload_hash" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "provider_ref" TEXT NOT NULL DEFAULT '',
    "failure_reason" TEXT NOT NULL DEFAULT '',
    "requested_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_entries" (
    "id" TEXT NOT NULL,
    "ledger" "FinanceLedger" NOT NULL,
    "kind" "FinanceEntryKind" NOT NULL,
    "account" TEXT NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "entry_key" TEXT,
    "invoice_id" TEXT,
    "payment_id" TEXT,
    "refund_id" TEXT,
    "campaign_id" TEXT,
    "event_id" TEXT,
    "actor_id" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_ref_key" ON "invoices"("ref");

-- CreateIndex
CREATE INDEX "invoices_owner_user_id_created_at_idx" ON "invoices"("owner_user_id", "created_at");

-- CreateIndex
CREATE INDEX "invoices_owner_company_id_created_at_idx" ON "invoices"("owner_company_id", "created_at");

-- CreateIndex
CREATE INDEX "invoices_status_created_at_idx" ON "invoices"("status", "created_at");

-- CreateIndex
CREATE INDEX "invoices_purpose_subject_id_idx" ON "invoices"("purpose", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_ref_key" ON "payments"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_provider_ref_key" ON "payments"("provider", "provider_ref");

-- CreateIndex
CREATE INDEX "payments_invoice_id_idx" ON "payments"("invoice_id");

-- CreateIndex
CREATE INDEX "payments_status_created_at_idx" ON "payments"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_provider_event_id_key" ON "payment_events"("provider", "event_id");

-- CreateIndex
CREATE INDEX "payment_events_reference_idx" ON "payment_events"("reference");

-- CreateIndex
CREATE INDEX "payment_events_received_at_idx" ON "payment_events"("received_at");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_ref_key" ON "refunds"("ref");

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- CreateIndex
CREATE INDEX "refunds_status_created_at_idx" ON "refunds"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "finance_entries_entry_key_key" ON "finance_entries"("entry_key");

-- CreateIndex
CREATE INDEX "finance_entries_ledger_created_at_idx" ON "finance_entries"("ledger", "created_at");

-- CreateIndex
CREATE INDEX "finance_entries_invoice_id_idx" ON "finance_entries"("invoice_id");

-- CreateIndex
CREATE INDEX "finance_entries_payment_id_idx" ON "finance_entries"("payment_id");

-- CreateIndex
CREATE INDEX "finance_entries_campaign_id_idx" ON "finance_entries"("campaign_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Integrity rules the application cannot be trusted to keep alone.
ALTER TABLE "invoices" ADD CONSTRAINT invoice_owner CHECK ((owner_user_id IS NOT NULL) <> (owner_company_id IS NOT NULL) AND (owner_kind = 'USER') = (owner_user_id IS NOT NULL));
ALTER TABLE "invoices" ADD CONSTRAINT invoice_amount CHECK (amount_kobo > 0 AND period_months BETWEEN 0 AND 36 AND char_length(description) <= 300 AND char_length(void_reason) <= 300);
ALTER TABLE "invoices" ADD CONSTRAINT invoice_state CHECK (
  (status = 'PAID') = (paid_at IS NOT NULL) AND (status = 'VOID') = (voided_at IS NOT NULL) AND (voided_at IS NULL OR char_length(btrim(void_reason)) >= 5)
);
ALTER TABLE "payments" ADD CONSTRAINT payment_amount CHECK (amount_kobo > 0 AND (received_kobo IS NULL OR received_kobo > 0) AND refunded_kobo >= 0 AND refunded_kobo <= COALESCE(received_kobo, amount_kobo));
ALTER TABLE "payments" ADD CONSTRAINT payment_state CHECK ((status IN ('SUCCEEDED', 'REVIEW')) = (settled_at IS NOT NULL) OR status = 'FAILED');
ALTER TABLE "payments" ADD CONSTRAINT payment_text CHECK (char_length(failure_reason) <= 500 AND char_length(review_note) <= 500 AND char_length(checkout_url) <= 1000);
ALTER TABLE "refunds" ADD CONSTRAINT refund_amount CHECK (amount_kobo > 0 AND char_length(btrim(reason)) BETWEEN 5 AND 500 AND char_length(failure_reason) <= 500);
ALTER TABLE "payment_events" ADD CONSTRAINT payment_event_text CHECK (char_length(event_id) BETWEEN 1 AND 200 AND char_length(kind) <= 100 AND char_length(note) <= 500);
-- Every entry is explained by a verified provider event or by a person (or the named automatic job) that is allowed to post it.
ALTER TABLE "finance_entries" ADD CONSTRAINT entry_amount CHECK (amount_kobo <> 0 AND account IN ('REVENUE', 'FUNDS_HELD', 'SUSPENSE'));
ALTER TABLE "finance_entries" ADD CONSTRAINT entry_traceable CHECK (event_id IS NOT NULL OR actor_id IS NOT NULL);
ALTER TABLE "finance_entries" ADD CONSTRAINT entry_adjustment CHECK (kind <> 'ADJUSTMENT' OR (actor_id IS NOT NULL AND actor_id NOT LIKE 'system%' AND char_length(btrim(note)) >= 5));
ALTER TABLE "finance_entries" ADD CONSTRAINT entry_kind_sign CHECK ((kind = 'PAYMENT' AND amount_kobo > 0) OR (kind = 'REFUND' AND amount_kobo < 0) OR kind IN ('SPEND', 'ADJUSTMENT'));

-- Only the platform's own checks write here. The people involved can read their own invoices and payments.
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_read ON "invoices" FOR SELECT USING (owner_user_id = app_current_user() OR owner_company_id = app_current_company() OR app_platform_admin());
CREATE POLICY admin_write ON "invoices" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_read ON "payments" FOR SELECT USING (EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_id));
CREATE POLICY admin_write ON "payments" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
ALTER TABLE "refunds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refunds" FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_read ON "refunds" FOR SELECT USING (EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_id));
CREATE POLICY admin_write ON "refunds" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
ALTER TABLE "payment_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_only ON "payment_events" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
ALTER TABLE "finance_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_only ON "finance_entries" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
