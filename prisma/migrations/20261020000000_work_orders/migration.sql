-- Phase 6b: maintenance. Contractors, work orders with history, materials and preventive schedules.

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('REPORTED', 'TRIAGED', 'APPROVED', 'ASSIGNED', 'IN_PROGRESS', 'AWAITING_PARTS', 'INSPECTION_REQUIRED', 'COMPLETED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkOrderPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "WorkOrderSource" AS ENUM ('REQUEST', 'INSPECTION', 'PREVENTIVE', 'OTHER');

-- CreateTable
CREATE TABLE "contractors" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trade" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contractors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "source" "WorkOrderSource" NOT NULL DEFAULT 'REQUEST',
    "priority" "WorkOrderPriority" NOT NULL DEFAULT 'NORMAL',
    "risk_level" "DefectSeverity" NOT NULL DEFAULT 'LOW',
    "safety_risk" BOOLEAN NOT NULL DEFAULT false,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'REPORTED',
    "requested_by_id" TEXT NOT NULL,
    "requester_name" TEXT NOT NULL DEFAULT '',
    "lease_id" TEXT,
    "schedule_id" TEXT,
    "scheduled_for" DATE,
    "assignee_id" TEXT,
    "contractor_id" TEXT,
    "target_date" DATE,
    "estimated_cost_kobo" BIGINT,
    "approved_cost_kobo" BIGINT,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "actual_cost_kobo" BIGINT,
    "started_at" TIMESTAMP(3),
    "completed_on" DATE,
    "completed_by_id" TEXT,
    "completion_notes" TEXT NOT NULL DEFAULT '',
    "evidence_ref" TEXT NOT NULL DEFAULT '',
    "verified_by_id" TEXT,
    "closed_at" TIMESTAMP(3),
    "cancel_reason" TEXT NOT NULL DEFAULT '',
    "downtime_from" DATE,
    "downtime_to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_events" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "work_order_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "from_status" "WorkOrderStatus",
    "to_status" "WorkOrderStatus",
    "note" TEXT NOT NULL DEFAULT '',
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_materials" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "work_order_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "unit_cost_kobo" BIGINT NOT NULL,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preventive_schedules" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "priority" "WorkOrderPriority" NOT NULL DEFAULT 'NORMAL',
    "interval_months" INTEGER NOT NULL,
    "next_due_on" DATE NOT NULL,
    "lead_days" INTEGER NOT NULL DEFAULT 14,
    "contractor_id" TEXT,
    "assignee_id" TEXT,
    "estimated_cost_kobo" BIGINT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "preventive_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contractors_company_id_name_key" ON "contractors"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_company_id_ref_key" ON "work_orders"("company_id", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_schedule_id_scheduled_for_key" ON "work_orders"("schedule_id", "scheduled_for");

-- CreateIndex
CREATE INDEX "work_orders_company_id_status_target_date_idx" ON "work_orders"("company_id", "status", "target_date");

-- CreateIndex
CREATE INDEX "work_orders_asset_id_idx" ON "work_orders"("asset_id");

-- CreateIndex
CREATE INDEX "work_order_events_company_id_work_order_id_idx" ON "work_order_events"("company_id", "work_order_id");

-- CreateIndex
CREATE INDEX "work_order_materials_company_id_work_order_id_idx" ON "work_order_materials"("company_id", "work_order_id");

-- CreateIndex
CREATE INDEX "preventive_schedules_company_id_active_next_due_on_idx" ON "preventive_schedules"("company_id", "active", "next_due_on");

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "preventive_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_materials" ADD CONSTRAINT "work_order_materials_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preventive_schedules" ADD CONSTRAINT "preventive_schedules_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preventive_schedules" ADD CONSTRAINT "preventive_schedules_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preventive_schedules" ADD CONSTRAINT "preventive_schedules_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "inspection_findings" ADD COLUMN "work_order_id" TEXT;
CREATE UNIQUE INDEX "inspection_findings_work_order_id_key" ON "inspection_findings"("work_order_id");
ALTER TABLE "inspection_findings" ADD CONSTRAINT "inspection_findings_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_costs" CHECK (
  ("estimated_cost_kobo" IS NULL OR "estimated_cost_kobo" >= 0) AND
  ("approved_cost_kobo" IS NULL OR "approved_cost_kobo" >= 0) AND
  ("actual_cost_kobo" IS NULL OR "actual_cost_kobo" >= 0));
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_downtime" CHECK ("downtime_from" IS NULL OR "downtime_to" IS NULL OR "downtime_to" >= "downtime_from");
ALTER TABLE "work_order_materials" ADD CONSTRAINT "work_order_materials_quantity" CHECK ("quantity" > 0 AND "unit_cost_kobo" >= 0);
ALTER TABLE "preventive_schedules" ADD CONSTRAINT "preventive_schedules_interval" CHECK ("interval_months" BETWEEN 1 AND 120);
ALTER TABLE "preventive_schedules" ADD CONSTRAINT "preventive_schedules_lead" CHECK ("lead_days" BETWEEN 0 AND 365);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contractors','work_orders','work_order_events','work_order_materials','preventive_schedules']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL
                      USING (company_id = app_current_company())
                      WITH CHECK (company_id = app_current_company())', t);
  END LOOP;
END $$;
