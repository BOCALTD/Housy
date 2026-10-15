-- Phase 5a: rent ledger. Receipts, duplicate-reference protection, approved adjustments, reversals,
-- reconciliation, deposit ledger, grace periods, units and custom payment frequencies.

-- AlterEnum
ALTER TYPE "RentFrequency" ADD VALUE 'CUSTOM';

-- AlterTable
ALTER TABLE "leases"
  ADD COLUMN "unit" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "grace_days" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "notice_days" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "interval_months" INTEGER,
  ADD COLUMN "permitted_use" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "other_terms" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "rent_charges" ADD COLUMN "adjusted_kobo" BIGINT NOT NULL DEFAULT 0;

-- CreateEnum
CREATE TYPE "AdjustmentKind" AS ENUM ('LATE_FEE', 'WAIVER', 'CREDIT_NOTE', 'CORRECTION');

-- CreateEnum
CREATE TYPE "AdjustmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DepositEntryKind" AS ENUM ('RECEIVED', 'DEDUCTION', 'REFUND');

-- CreateTable
CREATE TABLE "number_counters" (
    "company_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "number_counters_pkey" PRIMARY KEY ("company_id", "kind", "year")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "lease_id" TEXT NOT NULL,
    "no" TEXT NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "paid_on" DATE NOT NULL,
    "method" TEXT NOT NULL DEFAULT '',
    "payer_name" TEXT NOT NULL DEFAULT '',
    "evidence" TEXT NOT NULL,
    "evidence_key" TEXT NOT NULL,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_reconciliations" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "receipt_id" TEXT NOT NULL,
    "statement_ref" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "reconciled_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_reversals" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "receipt_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "reversed_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_reversals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rent_adjustments" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "charge_id" TEXT NOT NULL,
    "kind" "AdjustmentKind" NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "AdjustmentStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_id" TEXT NOT NULL,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rent_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposit_entries" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "lease_id" TEXT NOT NULL,
    "kind" "DepositEntryKind" NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "evidence" TEXT NOT NULL DEFAULT '',
    "entry_date" DATE NOT NULL,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deposit_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "receipts_company_id_no_key" ON "receipts"("company_id", "no");

-- CreateIndex
CREATE INDEX "receipts_company_id_evidence_key_idx" ON "receipts"("company_id", "evidence_key");

-- CreateIndex
CREATE INDEX "receipts_lease_id_idx" ON "receipts"("lease_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_reconciliations_receipt_id_key" ON "receipt_reconciliations"("receipt_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_reversals_receipt_id_key" ON "receipt_reversals"("receipt_id");

-- CreateIndex
CREATE INDEX "rent_adjustments_company_id_status_idx" ON "rent_adjustments"("company_id", "status");

-- CreateIndex
CREATE INDEX "rent_adjustments_charge_id_idx" ON "rent_adjustments"("charge_id");

-- CreateIndex
CREATE INDEX "deposit_entries_lease_id_idx" ON "deposit_entries"("lease_id");

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_lease_id_fkey" FOREIGN KEY ("lease_id") REFERENCES "leases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_reconciliations" ADD CONSTRAINT "receipt_reconciliations_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_reversals" ADD CONSTRAINT "receipt_reversals_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_adjustments" ADD CONSTRAINT "rent_adjustments_charge_id_fkey" FOREIGN KEY ("charge_id") REFERENCES "rent_charges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_entries" ADD CONSTRAINT "deposit_entries_lease_id_fkey" FOREIGN KEY ("lease_id") REFERENCES "leases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AlterTable: every payment belongs to a receipt.
ALTER TABLE "rent_payments" ADD COLUMN "receipt_id" TEXT;

-- Existing payments become one receipt each (same id, so the link is exact). The table owner is bound by
-- row-level security on these tables, so it is switched off for the backfill and restored straight after.
ALTER TABLE "rent_payments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "rent_charges" NO FORCE ROW LEVEL SECURITY;

INSERT INTO "receipts" ("id", "company_id", "lease_id", "no", "amount_kobo", "paid_on", "method", "payer_name",
                        "evidence", "evidence_key", "recorded_by_id", "created_at")
SELECT p."id", p."company_id", c."lease_id",
       'RCT-' || to_char(p."created_at", 'YYYY') || '-L'
         || lpad((row_number() OVER (PARTITION BY p."company_id" ORDER BY p."created_at", p."id"))::text, 5, '0'),
       p."amount_kobo", p."paid_on", '', '', p."evidence",
       lower(regexp_replace(p."evidence", '[^a-zA-Z0-9]', '', 'g')),
       p."recorded_by_id", p."created_at"
FROM "rent_payments" p
JOIN "rent_charges" c ON c."id" = p."charge_id";

UPDATE "rent_payments" SET "receipt_id" = "id";

ALTER TABLE "rent_payments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "rent_charges" FORCE ROW LEVEL SECURITY;

ALTER TABLE "rent_payments" ALTER COLUMN "receipt_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "rent_payments_receipt_id_idx" ON "rent_payments"("receipt_id");

-- AddForeignKey
ALTER TABLE "rent_payments" ADD CONSTRAINT "rent_payments_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Database-level guards: the ledger cannot go out of balance even if application code has a bug.
ALTER TABLE "rent_charges" ADD CONSTRAINT "rent_charges_paid_nonnegative" CHECK ("paid_kobo" >= 0);
ALTER TABLE "rent_charges" ADD CONSTRAINT "rent_charges_not_overpaid" CHECK ("amount_kobo" + "adjusted_kobo" >= "paid_kobo");
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_amount_positive" CHECK ("amount_kobo" > 0);
ALTER TABLE "rent_payments" ADD CONSTRAINT "rent_payments_amount_positive" CHECK ("amount_kobo" > 0);
ALTER TABLE "rent_adjustments" ADD CONSTRAINT "rent_adjustments_amount_nonzero" CHECK ("amount_kobo" <> 0);
ALTER TABLE "deposit_entries" ADD CONSTRAINT "deposit_entries_amount_positive" CHECK ("amount_kobo" > 0);
ALTER TABLE "leases" ADD CONSTRAINT "leases_grace_days_range" CHECK ("grace_days" BETWEEN 0 AND 90);
ALTER TABLE "leases" ADD CONSTRAINT "leases_notice_days_range" CHECK ("notice_days" BETWEEN 0 AND 365);
ALTER TABLE "leases" ADD CONSTRAINT "leases_interval_months_range" CHECK ("interval_months" IS NULL OR "interval_months" BETWEEN 1 AND 120);

-- Row-level security: every new company-owned table is isolated by company.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['number_counters','receipts','receipt_reconciliations','receipt_reversals',
                           'rent_adjustments','deposit_entries']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL
                      USING (company_id = app_current_company())
                      WITH CHECK (company_id = app_current_company())', t);
  END LOOP;
END $$;
