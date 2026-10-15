-- CreateEnum
CREATE TYPE "DealDocKind" AS ENUM ('OFFER_LETTER', 'SALES_AGREEMENT', 'TENANCY_AGREEMENT', 'TITLE_DOCUMENT', 'SURVEY', 'IDENTITY', 'PROOF_OF_FUNDS', 'LEGAL', 'OTHER');

-- CreateEnum
CREATE TYPE "DealPaymentKind" AS ENUM ('BOOKING_DEPOSIT', 'PART_PAYMENT', 'BALANCE', 'AGENCY_FEE', 'LEGAL_FEE', 'REFUND', 'OTHER');

-- CreateTable
CREATE TABLE "deal_documents" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "kind" "DealDocKind" NOT NULL,
    "title" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_payments" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "kind" "DealPaymentKind" NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "paid_on" DATE NOT NULL,
    "method" TEXT NOT NULL DEFAULT '',
    "reference" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "reverses_id" TEXT,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deal_documents_storage_key_key" ON "deal_documents"("storage_key");

-- CreateIndex
CREATE INDEX "deal_documents_company_id_deal_id_idx" ON "deal_documents"("company_id", "deal_id");

-- CreateIndex
CREATE UNIQUE INDEX "deal_payments_reverses_id_key" ON "deal_payments"("reverses_id");

-- CreateIndex
CREATE INDEX "deal_payments_company_id_deal_id_paid_on_idx" ON "deal_payments"("company_id", "deal_id", "paid_on");

-- AddForeignKey
ALTER TABLE "deal_documents" ADD CONSTRAINT "deal_documents_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_payments" ADD CONSTRAINT "deal_payments_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Links from existing records to clients and deals. Validated by the application inside the company's own rows.
ALTER TABLE "correspondence" ADD COLUMN "client_id" TEXT, ADD COLUMN "deal_id" TEXT;
CREATE INDEX "correspondence_company_id_deal_id_idx" ON "correspondence"("company_id", "deal_id");
CREATE INDEX "correspondence_company_id_client_id_idx" ON "correspondence"("company_id", "client_id");
ALTER TABLE "tasks" ADD COLUMN "deal_id" TEXT;
CREATE INDEX "tasks_company_id_deal_id_idx" ON "tasks"("company_id", "deal_id");
ALTER TABLE "client_activities" ADD COLUMN "deal_id" TEXT;
CREATE INDEX "client_activities_company_id_deal_id_idx" ON "client_activities"("company_id", "deal_id");

ALTER TABLE "deal_payments" ADD CONSTRAINT deal_payments_amount_positive CHECK (amount_kobo > 0);
ALTER TABLE "deal_payments" ADD CONSTRAINT deal_payments_not_own_reversal CHECK (reverses_id IS NULL OR reverses_id <> id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['deal_documents','deal_payments']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL
                      USING (company_id = app_current_company())
                      WITH CHECK (company_id = app_current_company())', t);
  END LOOP;
END $$;
