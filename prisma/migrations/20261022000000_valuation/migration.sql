-- Phase 7a: valuation instructions, worksheets, comparable evidence, assumptions, documents and reports.

-- CreateEnum
CREATE TYPE "ValuationPurpose" AS ENUM ('SALE', 'PURCHASE', 'MORTGAGE_SECURITY', 'INSURANCE', 'FINANCIAL_REPORTING', 'TAXATION', 'LITIGATION', 'OTHER');

-- CreateEnum
CREATE TYPE "ValuationBasis" AS ENUM ('MARKET_VALUE', 'MARKET_RENT', 'REINSTATEMENT_COST', 'FORCED_SALE_VALUE', 'OTHER');

-- CreateEnum
CREATE TYPE "ValuationPremise" AS ENUM ('STANDARD', 'GOING_CONCERN', 'GONE_CONCERN');

-- CreateEnum
CREATE TYPE "ValuationStatus" AS ENUM ('INSTRUCTED', 'IN_PROGRESS', 'IN_REVIEW', 'APPROVED', 'ISSUED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ValuationMethod" AS ENUM ('SALES_COMPARISON', 'INCOME_CAPITALISATION', 'COST_APPROACH');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('SALE', 'LETTING', 'LISTING', 'OFFER', 'OTHER');

-- CreateEnum
CREATE TYPE "EntryKind" AS ENUM ('PREMISE', 'ASSUMPTION', 'SPECIAL_ASSUMPTION', 'LIMITATION');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "valuation_instructions" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "client_reference" TEXT NOT NULL DEFAULT '',
    "purpose" "ValuationPurpose" NOT NULL,
    "purpose_note" TEXT NOT NULL DEFAULT '',
    "basis" "ValuationBasis" NOT NULL DEFAULT 'MARKET_VALUE',
    "premise" "ValuationPremise" NOT NULL DEFAULT 'STANDARD',
    "asset_description" TEXT NOT NULL DEFAULT '',
    "scope" TEXT NOT NULL DEFAULT '',
    "instruction_date" DATE NOT NULL,
    "valuation_date" DATE,
    "inspection_date" DATE,
    "due_date" DATE,
    "status" "ValuationStatus" NOT NULL DEFAULT 'INSTRUCTED',
    "assigned_to_id" TEXT,
    "professional_name" TEXT NOT NULL DEFAULT '',
    "professional_body" TEXT NOT NULL DEFAULT '',
    "registration_no" TEXT NOT NULL DEFAULT '',
    "issued_on" DATE,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "valuation_instructions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valuation_worksheets" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "instruction_id" TEXT NOT NULL,
    "method" "ValuationMethod" NOT NULL,
    "inputs" JSONB NOT NULL DEFAULT '{}',
    "result_kobo" BIGINT,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT NOT NULL DEFAULT '',
    "calculated_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "valuation_worksheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valuation_comparables" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "instruction_id" TEXT NOT NULL,
    "kind" "EvidenceKind" NOT NULL DEFAULT 'SALE',
    "address" TEXT NOT NULL,
    "evidence_date" DATE NOT NULL,
    "price_kobo" BIGINT NOT NULL,
    "area_sqm100" INTEGER NOT NULL,
    "adjustment_bps" INTEGER NOT NULL DEFAULT 0,
    "adjustment_note" TEXT NOT NULL DEFAULT '',
    "weight_bps" INTEGER NOT NULL DEFAULT 10000,
    "source" TEXT NOT NULL DEFAULT '',
    "verified_by_id" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "valuation_comparables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valuation_entries" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "instruction_id" TEXT NOT NULL,
    "kind" "EntryKind" NOT NULL,
    "text" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "valuation_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valuation_documents" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "instruction_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "valuation_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valuation_reports" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "instruction_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "summary" TEXT NOT NULL DEFAULT '',
    "conclusion" TEXT NOT NULL DEFAULT '',
    "concluded_value_kobo" BIGINT,
    "reconciliation_note" TEXT NOT NULL DEFAULT '',
    "ai_assisted" BOOLEAN NOT NULL DEFAULT false,
    "ai_note" TEXT NOT NULL DEFAULT '',
    "snapshot" JSONB,
    "author_id" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT NOT NULL DEFAULT '',
    "review_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "superseded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "valuation_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "valuation_instructions_company_id_ref_key" ON "valuation_instructions"("company_id", "ref");

-- CreateIndex
CREATE INDEX "valuation_instructions_company_id_status_idx" ON "valuation_instructions"("company_id", "status");

-- CreateIndex
CREATE INDEX "valuation_instructions_company_id_asset_id_idx" ON "valuation_instructions"("company_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "valuation_worksheets_instruction_id_method_key" ON "valuation_worksheets"("instruction_id", "method");

-- CreateIndex
CREATE INDEX "valuation_worksheets_company_id_idx" ON "valuation_worksheets"("company_id");

-- CreateIndex
CREATE INDEX "valuation_comparables_company_id_instruction_id_idx" ON "valuation_comparables"("company_id", "instruction_id");

-- CreateIndex
CREATE INDEX "valuation_entries_company_id_instruction_id_idx" ON "valuation_entries"("company_id", "instruction_id");

-- CreateIndex
CREATE UNIQUE INDEX "valuation_documents_storage_key_key" ON "valuation_documents"("storage_key");

-- CreateIndex
CREATE INDEX "valuation_documents_company_id_instruction_id_idx" ON "valuation_documents"("company_id", "instruction_id");

-- CreateIndex
CREATE UNIQUE INDEX "valuation_reports_instruction_id_version_key" ON "valuation_reports"("instruction_id", "version");

-- CreateIndex
CREATE INDEX "valuation_reports_company_id_status_idx" ON "valuation_reports"("company_id", "status");

-- AddForeignKey
ALTER TABLE "valuation_instructions" ADD CONSTRAINT "valuation_instructions_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_worksheets" ADD CONSTRAINT "valuation_worksheets_instruction_id_fkey" FOREIGN KEY ("instruction_id") REFERENCES "valuation_instructions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_comparables" ADD CONSTRAINT "valuation_comparables_instruction_id_fkey" FOREIGN KEY ("instruction_id") REFERENCES "valuation_instructions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_entries" ADD CONSTRAINT "valuation_entries_instruction_id_fkey" FOREIGN KEY ("instruction_id") REFERENCES "valuation_instructions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_documents" ADD CONSTRAINT "valuation_documents_instruction_id_fkey" FOREIGN KEY ("instruction_id") REFERENCES "valuation_instructions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_reports" ADD CONSTRAINT "valuation_reports_instruction_id_fkey" FOREIGN KEY ("instruction_id") REFERENCES "valuation_instructions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Sanity checks the application also enforces.
ALTER TABLE "valuation_comparables" ADD CONSTRAINT "valuation_comparables_price_positive" CHECK ("price_kobo" > 0);
ALTER TABLE "valuation_comparables" ADD CONSTRAINT "valuation_comparables_area_positive" CHECK ("area_sqm100" > 0);
ALTER TABLE "valuation_comparables" ADD CONSTRAINT "valuation_comparables_adjustment_range" CHECK ("adjustment_bps" > -5000 AND "adjustment_bps" <= 5000);
ALTER TABLE "valuation_comparables" ADD CONSTRAINT "valuation_comparables_weight_nonneg" CHECK ("weight_bps" >= 0);
ALTER TABLE "valuation_reports" ADD CONSTRAINT "valuation_reports_version_positive" CHECK ("version" >= 1);
ALTER TABLE "valuation_reports" ADD CONSTRAINT "valuation_reports_value_positive" CHECK ("concluded_value_kobo" IS NULL OR "concluded_value_kobo" > 0);
ALTER TABLE "valuation_reports" ADD CONSTRAINT "valuation_reports_decider_differs" CHECK ("decided_by_id" IS NULL OR "decided_by_id" <> "author_id");
ALTER TABLE "valuation_documents" ADD CONSTRAINT "valuation_documents_size_positive" CHECK ("size_bytes" > 0);

-- Row-level security: every row belongs to one company.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['valuation_instructions','valuation_worksheets','valuation_comparables','valuation_entries','valuation_documents','valuation_reports']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL
                      USING (company_id = app_current_company())
                      WITH CHECK (company_id = app_current_company())', t);
  END LOOP;
END $$;

-- An approved report is the professional's signed-off opinion. It cannot be edited or deleted. The only
-- permitted change is being marked superseded when a newer version is approved.
CREATE FUNCTION valuation_report_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('APPROVED', 'SUPERSEDED') THEN
      RAISE EXCEPTION 'An approved valuation report cannot be deleted' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'APPROVED' THEN
    IF NEW.status = 'SUPERSEDED'
       AND (to_jsonb(NEW) - 'status' - 'superseded_at' - 'updated_at') = (to_jsonb(OLD) - 'status' - 'superseded_at' - 'updated_at') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'An approved valuation report cannot be changed. Create a new version.' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'SUPERSEDED' THEN
    RAISE EXCEPTION 'A superseded valuation report cannot be changed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER valuation_report_frozen BEFORE UPDATE OR DELETE ON valuation_reports
  FOR EACH ROW EXECUTE FUNCTION valuation_report_frozen();
