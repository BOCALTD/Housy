-- Phase 7b: construction and renovation projects, work packages, milestones, commitments, invoices, variations and forecasts.

-- CreateEnum
CREATE TYPE "ProjectKind" AS ENUM ('CONSTRUCTION', 'RENOVATION', 'FIT_OUT', 'REPAIR_PROGRAMME');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BudgetStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED');

-- CreateEnum
CREATE TYPE "WorkStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'DONE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('RECEIVED', 'APPROVED', 'REJECTED', 'PAID');

-- CreateEnum
CREATE TYPE "VariationTarget" AS ENUM ('COMMITMENT', 'BUDGET');

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "ProjectKind" NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "ProjectStatus" NOT NULL DEFAULT 'PLANNING',
    "manager_id" TEXT,
    "planned_start" DATE NOT NULL,
    "planned_end" DATE NOT NULL,
    "actual_start" DATE,
    "actual_end" DATE,
    "contingency_kobo" BIGINT NOT NULL DEFAULT 0,
    "budget_status" "BudgetStatus" NOT NULL DEFAULT 'DRAFT',
    "budget_submitted_by_id" TEXT,
    "budget_decided_by_id" TEXT,
    "budget_decided_at" TIMESTAMP(3),
    "budget_note" TEXT NOT NULL DEFAULT '',
    "approved_budget_kobo" BIGINT,
    "hold_reason" TEXT NOT NULL DEFAULT '',
    "cancel_reason" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_packages" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "responsible_id" TEXT,
    "contractor_id" TEXT,
    "planned_start" DATE NOT NULL,
    "planned_end" DATE NOT NULL,
    "actual_start" DATE,
    "actual_end" DATE,
    "percent_complete" INTEGER NOT NULL DEFAULT 0,
    "status" "WorkStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "budget_kobo" BIGINT NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestones" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "work_package_id" TEXT,
    "title" TEXT NOT NULL,
    "due_on" DATE NOT NULL,
    "achieved_on" DATE,
    "achieved_by_id" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commitments" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "work_package_id" TEXT,
    "ref" TEXT NOT NULL,
    "supplier_name" TEXT NOT NULL,
    "contractor_id" TEXT,
    "description" TEXT NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_id" TEXT NOT NULL,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commitments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_invoices" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "commitment_id" TEXT NOT NULL,
    "invoice_no" TEXT NOT NULL,
    "invoice_date" DATE NOT NULL,
    "due_date" DATE,
    "amount_kobo" BIGINT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'RECEIVED',
    "recorded_by_id" TEXT NOT NULL,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT NOT NULL DEFAULT '',
    "paid_on" DATE,
    "paid_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variations" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "target" "VariationTarget" NOT NULL,
    "commitment_id" TEXT,
    "work_package_id" TEXT,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "time_impact_days" INTEGER NOT NULL DEFAULT 0,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_id" TEXT NOT NULL,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_forecasts" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "work_package_id" TEXT NOT NULL,
    "etc_kobo" BIGINT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_forecasts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "projects_company_id_ref_key" ON "projects"("company_id", "ref");

-- CreateIndex
CREATE INDEX "projects_company_id_status_idx" ON "projects"("company_id", "status");

-- CreateIndex
CREATE INDEX "projects_company_id_asset_id_idx" ON "projects"("company_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_packages_project_id_code_key" ON "work_packages"("project_id", "code");

-- CreateIndex
CREATE INDEX "work_packages_company_id_project_id_idx" ON "work_packages"("company_id", "project_id");

-- CreateIndex
CREATE INDEX "milestones_company_id_project_id_idx" ON "milestones"("company_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "commitments_company_id_ref_key" ON "commitments"("company_id", "ref");

-- CreateIndex
CREATE INDEX "commitments_company_id_project_id_idx" ON "commitments"("company_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_invoices_commitment_id_invoice_no_key" ON "project_invoices"("commitment_id", "invoice_no");

-- CreateIndex
CREATE INDEX "project_invoices_company_id_project_id_idx" ON "project_invoices"("company_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "variations_company_id_ref_key" ON "variations"("company_id", "ref");

-- CreateIndex
CREATE INDEX "variations_company_id_project_id_idx" ON "variations"("company_id", "project_id");

-- CreateIndex
CREATE INDEX "project_forecasts_lookup_idx" ON "project_forecasts"("company_id", "project_id", "work_package_id", "created_at");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_packages" ADD CONSTRAINT "work_packages_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_work_package_id_fkey" FOREIGN KEY ("work_package_id") REFERENCES "work_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_work_package_id_fkey" FOREIGN KEY ("work_package_id") REFERENCES "work_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_invoices" ADD CONSTRAINT "project_invoices_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_invoices" ADD CONSTRAINT "project_invoices_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variations" ADD CONSTRAINT "variations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variations" ADD CONSTRAINT "variations_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_forecasts" ADD CONSTRAINT "project_forecasts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_forecasts" ADD CONSTRAINT "project_forecasts_work_package_id_fkey" FOREIGN KEY ("work_package_id") REFERENCES "work_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Sanity checks the application also enforces.
ALTER TABLE "projects" ADD CONSTRAINT "projects_dates_ordered" CHECK ("planned_end" >= "planned_start");
ALTER TABLE "projects" ADD CONSTRAINT "projects_contingency_nonneg" CHECK ("contingency_kobo" >= 0);
ALTER TABLE "projects" ADD CONSTRAINT "projects_approved_budget_positive" CHECK ("approved_budget_kobo" IS NULL OR "approved_budget_kobo" >= 0);
ALTER TABLE "projects" ADD CONSTRAINT "projects_budget_approved_has_figure" CHECK ("budget_status" <> 'APPROVED' OR "approved_budget_kobo" IS NOT NULL);
ALTER TABLE "projects" ADD CONSTRAINT "projects_budget_decider_differs" CHECK ("budget_decided_by_id" IS NULL OR "budget_submitted_by_id" IS NULL OR "budget_decided_by_id" <> "budget_submitted_by_id");
ALTER TABLE "work_packages" ADD CONSTRAINT "work_packages_dates_ordered" CHECK ("planned_end" >= "planned_start");
ALTER TABLE "work_packages" ADD CONSTRAINT "work_packages_percent_range" CHECK ("percent_complete" BETWEEN 0 AND 100);
ALTER TABLE "work_packages" ADD CONSTRAINT "work_packages_budget_nonneg" CHECK ("budget_kobo" >= 0);
ALTER TABLE "work_packages" ADD CONSTRAINT "work_packages_done_is_complete" CHECK ("status" <> 'DONE' OR "percent_complete" = 100);
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_amount_positive" CHECK ("amount_kobo" > 0);
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_decider_differs" CHECK ("decided_by_id" IS NULL OR "decided_by_id" <> "requested_by_id");
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_decided_has_decider" CHECK ("status" = 'PENDING' OR "decided_by_id" IS NOT NULL);
ALTER TABLE "project_invoices" ADD CONSTRAINT "project_invoices_amount_positive" CHECK ("amount_kobo" > 0);
ALTER TABLE "project_invoices" ADD CONSTRAINT "project_invoices_decider_differs" CHECK ("decided_by_id" IS NULL OR "decided_by_id" <> "recorded_by_id");
ALTER TABLE "project_invoices" ADD CONSTRAINT "project_invoices_paid_has_date" CHECK ("status" <> 'PAID' OR ("paid_on" IS NOT NULL AND "paid_by_id" IS NOT NULL));
ALTER TABLE "variations" ADD CONSTRAINT "variations_amount_nonzero" CHECK ("amount_kobo" <> 0);
ALTER TABLE "variations" ADD CONSTRAINT "variations_decider_differs" CHECK ("decided_by_id" IS NULL OR "decided_by_id" <> "requested_by_id");
ALTER TABLE "variations" ADD CONSTRAINT "variations_target_shape" CHECK (("target" = 'COMMITMENT' AND "commitment_id" IS NOT NULL) OR ("target" = 'BUDGET' AND "commitment_id" IS NULL));
ALTER TABLE "project_forecasts" ADD CONSTRAINT "project_forecasts_etc_nonneg" CHECK ("etc_kobo" >= 0);

-- Row-level security: every row belongs to one company.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['projects','work_packages','milestones','commitments','project_invoices','variations','project_forecasts']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL
                      USING (company_id = app_current_company())
                      WITH CHECK (company_id = app_current_company())', t);
  END LOOP;
END $$;
