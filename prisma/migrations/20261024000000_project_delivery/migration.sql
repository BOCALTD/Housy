-- Phase 7c-1: project parties, procurement, stock use, risks, site inspections, progress updates and quality checks.

-- CreateEnum
CREATE TYPE "PartyRole" AS ENUM ('CONTRACTOR', 'CONSULTANT', 'SUPPLIER', 'OTHER');

-- CreateEnum
CREATE TYPE "ProcurementStatus" AS ENUM ('REQUIRED', 'ORDERED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RiskStatus" AS ENUM ('OPEN', 'MITIGATING', 'CLOSED', 'OCCURRED');

-- CreateEnum
CREATE TYPE "SiteOutcome" AS ENUM ('SATISFACTORY', 'ACTIONS_REQUIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "QualityResult" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'WAIVED');

-- CreateTable
CREATE TABLE "project_parties" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "role" "PartyRole" NOT NULL,
    "contractor_id" TEXT,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "appointed_on" DATE,
    "ended_on" DATE,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_items" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "work_package_id" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "required_by" DATE NOT NULL,
    "status" "ProcurementStatus" NOT NULL DEFAULT 'REQUIRED',
    "supplier_name" TEXT NOT NULL DEFAULT '',
    "commitment_id" TEXT,
    "ordered_on" DATE,
    "delivered_on" DATE,
    "delivered_qty" INTEGER NOT NULL DEFAULT 0,
    "inventory_item_id" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_stock_uses" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "work_package_id" TEXT,
    "item_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_cost_kobo" BIGINT NOT NULL DEFAULT 0,
    "movement_id" TEXT NOT NULL,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_stock_uses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_risks" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "likelihood" INTEGER NOT NULL,
    "impact" INTEGER NOT NULL,
    "owner_id" TEXT,
    "mitigation" TEXT NOT NULL DEFAULT '',
    "status" "RiskStatus" NOT NULL DEFAULT 'OPEN',
    "review_on" DATE,
    "close_note" TEXT NOT NULL DEFAULT '',
    "closed_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_risks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_inspections" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "work_package_id" TEXT,
    "inspected_on" DATE NOT NULL,
    "inspector_id" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "actions" TEXT NOT NULL DEFAULT '',
    "outcome" "SiteOutcome" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress_updates" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "report_date" DATE NOT NULL,
    "summary" TEXT NOT NULL,
    "issues" TEXT NOT NULL DEFAULT '',
    "next_steps" TEXT NOT NULL DEFAULT '',
    "percent_complete" INTEGER NOT NULL,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "progress_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_checks" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "work_package_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "standard" TEXT NOT NULL DEFAULT '',
    "result" "QualityResult" NOT NULL DEFAULT 'PENDING',
    "checked_by_id" TEXT,
    "checked_on" DATE,
    "note" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quality_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_parties_project_id_role_name_key" ON "project_parties"("project_id", "role", "name");

-- CreateIndex
CREATE INDEX "project_parties_company_id_project_id_idx" ON "project_parties"("company_id", "project_id");

-- CreateIndex
CREATE INDEX "procurement_items_company_id_project_id_idx" ON "procurement_items"("company_id", "project_id");

-- CreateIndex
CREATE INDEX "project_stock_uses_company_id_project_id_idx" ON "project_stock_uses"("company_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_risks_project_id_ref_key" ON "project_risks"("project_id", "ref");

-- CreateIndex
CREATE INDEX "project_risks_company_id_project_id_idx" ON "project_risks"("company_id", "project_id");

-- CreateIndex
CREATE INDEX "site_inspections_company_id_project_id_inspected_on_idx" ON "site_inspections"("company_id", "project_id", "inspected_on");

-- CreateIndex
CREATE INDEX "progress_updates_company_id_project_id_report_date_idx" ON "progress_updates"("company_id", "project_id", "report_date");

-- CreateIndex
CREATE INDEX "quality_checks_company_id_project_id_work_package_id_idx" ON "quality_checks"("company_id", "project_id", "work_package_id");

-- AddForeignKey
ALTER TABLE "project_parties" ADD CONSTRAINT "project_parties_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_items" ADD CONSTRAINT "procurement_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_items" ADD CONSTRAINT "procurement_items_work_package_id_fkey" FOREIGN KEY ("work_package_id") REFERENCES "work_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_stock_uses" ADD CONSTRAINT "project_stock_uses_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_stock_uses" ADD CONSTRAINT "project_stock_uses_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_risks" ADD CONSTRAINT "project_risks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_inspections" ADD CONSTRAINT "site_inspections_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_updates" ADD CONSTRAINT "progress_updates_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_work_package_id_fkey" FOREIGN KEY ("work_package_id") REFERENCES "work_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Sanity checks the application also enforces.
ALTER TABLE "procurement_items" ADD CONSTRAINT "procurement_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "procurement_items" ADD CONSTRAINT "procurement_items_delivered_nonneg" CHECK ("delivered_qty" >= 0);
ALTER TABLE "procurement_items" ADD CONSTRAINT "procurement_items_ordered_has_supplier" CHECK ("status" NOT IN ('ORDERED', 'DELIVERED') OR "supplier_name" <> '');
ALTER TABLE "procurement_items" ADD CONSTRAINT "procurement_items_delivered_has_date" CHECK ("status" <> 'DELIVERED' OR ("delivered_on" IS NOT NULL AND "delivered_qty" >= "quantity"));
ALTER TABLE "project_stock_uses" ADD CONSTRAINT "project_stock_uses_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "project_risks" ADD CONSTRAINT "project_risks_likelihood_range" CHECK ("likelihood" BETWEEN 1 AND 5);
ALTER TABLE "project_risks" ADD CONSTRAINT "project_risks_impact_range" CHECK ("impact" BETWEEN 1 AND 5);
ALTER TABLE "project_risks" ADD CONSTRAINT "project_risks_closed_has_note" CHECK ("status" <> 'CLOSED' OR ("close_note" <> '' AND "closed_at" IS NOT NULL));
ALTER TABLE "progress_updates" ADD CONSTRAINT "progress_updates_percent_range" CHECK ("percent_complete" BETWEEN 0 AND 100);
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_decided_has_checker" CHECK ("result" = 'PENDING' OR ("checked_by_id" IS NOT NULL AND "checked_on" IS NOT NULL));
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_waiver_has_note" CHECK ("result" <> 'WAIVED' OR "note" <> '');

-- Row-level security: every row belongs to one company.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['project_parties','procurement_items','project_stock_uses','project_risks','site_inspections','progress_updates','quality_checks']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL
                      USING (company_id = app_current_company())
                      WITH CHECK (company_id = app_current_company())', t);
  END LOOP;
END $$;
