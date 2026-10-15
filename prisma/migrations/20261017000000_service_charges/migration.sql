-- Phase 5c: service charges. Budgets, tenant assessments, collections, expenses and the fund.

ALTER TABLE "leases" ADD COLUMN "floor_area_sqm" INTEGER;
ALTER TABLE "leases" ADD CONSTRAINT "leases_floor_area_positive" CHECK ("floor_area_sqm" IS NULL OR "floor_area_sqm" BETWEEN 1 AND 10000000);

-- CreateEnum
CREATE TYPE "ServiceMethod" AS ENUM ('EQUAL', 'FLOOR_AREA', 'FIXED');

-- CreateEnum
CREATE TYPE "ServicePeriodStatus" AS ENUM ('OPEN', 'ASSESSED');

-- CreateTable
CREATE TABLE "service_charge_periods" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "budget_kobo" BIGINT NOT NULL,
    "method" "ServiceMethod" NOT NULL,
    "status" "ServicePeriodStatus" NOT NULL DEFAULT 'OPEN',
    "assessed_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_charge_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_assessments" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "lease_id" TEXT NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "due_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_collections" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "assessment_id" TEXT NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "paid_on" DATE NOT NULL,
    "method" TEXT NOT NULL DEFAULT '',
    "evidence" TEXT NOT NULL,
    "evidence_key" TEXT NOT NULL,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_collection_reversals" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "collection_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "reversed_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_collection_reversals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_expenses" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "supplier" TEXT NOT NULL DEFAULT '',
    "amount_kobo" BIGINT NOT NULL,
    "incurred_on" DATE NOT NULL,
    "evidence" TEXT NOT NULL,
    "status" "AdjustmentStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_id" TEXT NOT NULL,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_charge_periods_company_id_asset_id_idx" ON "service_charge_periods"("company_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_assessments_period_id_lease_id_key" ON "service_assessments"("period_id", "lease_id");

-- CreateIndex
CREATE INDEX "service_assessments_company_id_lease_id_idx" ON "service_assessments"("company_id", "lease_id");

-- CreateIndex
CREATE INDEX "service_collections_company_id_assessment_id_idx" ON "service_collections"("company_id", "assessment_id");

-- CreateIndex
CREATE INDEX "service_collections_company_id_evidence_key_idx" ON "service_collections"("company_id", "evidence_key");

-- CreateIndex
CREATE UNIQUE INDEX "service_collection_reversals_collection_id_key" ON "service_collection_reversals"("collection_id");

-- CreateIndex
CREATE INDEX "service_expenses_company_id_period_id_idx" ON "service_expenses"("company_id", "period_id");

-- AddForeignKey
ALTER TABLE "service_charge_periods" ADD CONSTRAINT "service_charge_periods_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_assessments" ADD CONSTRAINT "service_assessments_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "service_charge_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_assessments" ADD CONSTRAINT "service_assessments_lease_id_fkey" FOREIGN KEY ("lease_id") REFERENCES "leases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_collections" ADD CONSTRAINT "service_collections_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "service_assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_collection_reversals" ADD CONSTRAINT "service_collection_reversals_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "service_collections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_expenses" ADD CONSTRAINT "service_expenses_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "service_charge_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "service_charge_periods" ADD CONSTRAINT "service_periods_dates" CHECK ("end_date" > "start_date");
ALTER TABLE "service_charge_periods" ADD CONSTRAINT "service_periods_budget" CHECK ("budget_kobo" > 0);
ALTER TABLE "service_assessments" ADD CONSTRAINT "service_assessments_amount" CHECK ("amount_kobo" >= 0);
ALTER TABLE "service_collections" ADD CONSTRAINT "service_collections_amount" CHECK ("amount_kobo" > 0);
ALTER TABLE "service_expenses" ADD CONSTRAINT "service_expenses_amount" CHECK ("amount_kobo" > 0);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['service_charge_periods','service_assessments','service_collections',
                           'service_collection_reversals','service_expenses']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL
                      USING (company_id = app_current_company())
                      WITH CHECK (company_id = app_current_company())', t);
  END LOOP;
END $$;
