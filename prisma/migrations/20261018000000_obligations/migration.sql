-- Phase 5d: obligations, reminders and compliance calendar.

ALTER TABLE "companies" ADD COLUMN "reminder_lead_days" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "companies" ADD COLUMN "escalation_days" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "companies" ADD CONSTRAINT "companies_reminder_lead_range" CHECK ("reminder_lead_days" BETWEEN 1 AND 365);
ALTER TABLE "companies" ADD CONSTRAINT "companies_escalation_range" CHECK ("escalation_days" BETWEEN 1 AND 90);

-- CreateEnum
CREATE TYPE "ObligationKind" AS ENUM ('LAND_USE_CHARGE', 'TENEMENT_RATE', 'GROUND_RENT', 'CONSENT_FEE', 'STAMP_DUTY', 'WITHHOLDING_TAX', 'PERMIT', 'INSURANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "ObligationStatus" AS ENUM ('OPEN', 'SATISFIED', 'CANCELLED');

-- CreateTable
CREATE TABLE "obligations" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "asset_id" TEXT,
    "kind" "ObligationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "authority" TEXT NOT NULL DEFAULT '',
    "jurisdiction" TEXT NOT NULL DEFAULT '',
    "amount_kobo" BIGINT,
    "due_date" DATE NOT NULL,
    "recurrence_months" INTEGER,
    "next_review_on" DATE,
    "requires_professional_review" BOOLEAN NOT NULL DEFAULT false,
    "reviewed_by" TEXT NOT NULL DEFAULT '',
    "reviewed_on" DATE,
    "notes" TEXT NOT NULL DEFAULT '',
    "status" "ObligationStatus" NOT NULL DEFAULT 'OPEN',
    "cancel_reason" TEXT NOT NULL DEFAULT '',
    "rolled_from_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obligation_filings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "obligation_id" TEXT NOT NULL,
    "completed_on" DATE NOT NULL,
    "amount_paid_kobo" BIGINT,
    "evidence" TEXT NOT NULL,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "obligation_filings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "obligations_rolled_from_id_key" ON "obligations"("rolled_from_id");

-- CreateIndex
CREATE INDEX "obligations_company_id_status_due_date_idx" ON "obligations"("company_id", "status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "obligation_filings_obligation_id_key" ON "obligation_filings"("obligation_id");

-- AddForeignKey
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_rolled_from_id_fkey" FOREIGN KEY ("rolled_from_id") REFERENCES "obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_filings" ADD CONSTRAINT "obligation_filings_obligation_id_fkey" FOREIGN KEY ("obligation_id") REFERENCES "obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "obligations" ADD CONSTRAINT "obligations_amount" CHECK ("amount_kobo" IS NULL OR "amount_kobo" >= 0);
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_recurrence" CHECK ("recurrence_months" IS NULL OR "recurrence_months" BETWEEN 1 AND 120);
ALTER TABLE "obligation_filings" ADD CONSTRAINT "obligation_filings_amount" CHECK ("amount_paid_kobo" IS NULL OR "amount_paid_kobo" >= 0);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['obligations','obligation_filings']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL
                      USING (company_id = app_current_company())
                      WITH CHECK (company_id = app_current_company())', t);
  END LOOP;
END $$;
