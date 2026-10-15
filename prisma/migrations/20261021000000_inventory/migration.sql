-- Phase 6c: inventory register, stock movements, adjustments, physical counts and handover inventory schedules.

-- CreateEnum
CREATE TYPE "InventoryKind" AS ENUM ('FIXED_ASSET', 'MOVABLE', 'CONSUMABLE');

-- CreateEnum
CREATE TYPE "InventoryItemStatus" AS ENUM ('ACTIVE', 'DISPOSED');

-- CreateEnum
CREATE TYPE "MovementKind" AS ENUM ('RECEIPT', 'ISSUE', 'TRANSFER', 'RETURN', 'CONSUMPTION', 'ADJUSTMENT', 'LOSS', 'DAMAGE', 'DISPOSAL');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CountStatus" AS ENUM ('OPEN', 'SUBMITTED', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('DRAFT', 'ACKNOWLEDGED');

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "item_no" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "kind" "InventoryKind" NOT NULL,
    "asset_id" TEXT,
    "serial_number" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "manufacturer" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "condition" "ConditionRating" NOT NULL DEFAULT 'GOOD',
    "location" TEXT NOT NULL DEFAULT '',
    "custodian_id" TEXT,
    "acquired_on" DATE,
    "unit_cost_kobo" BIGINT,
    "ownership" TEXT NOT NULL DEFAULT 'Owned',
    "warranty_until" DATE,
    "reorder_level" INTEGER,
    "last_verified_on" DATE,
    "status" "InventoryItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "kind" "MovementKind" NOT NULL,
    "delta" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "from_location" TEXT NOT NULL DEFAULT '',
    "to_location" TEXT NOT NULL DEFAULT '',
    "work_order_id" TEXT,
    "reference" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "performed_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "adjustment_id" TEXT,
    "count_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_adjustments" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "kind" "MovementKind" NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_id" TEXT NOT NULL,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_counts" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "asset_id" TEXT,
    "status" "CountStatus" NOT NULL DEFAULT 'OPEN',
    "started_by_id" TEXT NOT NULL,
    "submitted_by_id" TEXT,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_lines" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "count_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "expected_qty" INTEGER NOT NULL,
    "counted_qty" INTEGER,
    "note" TEXT NOT NULL DEFAULT '',
    "counted_by_id" TEXT,

    CONSTRAINT "inventory_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handover_schedules" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "lease_id" TEXT NOT NULL,
    "kind" "HandoverKind" NOT NULL,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'DRAFT',
    "acknowledged_by" TEXT NOT NULL DEFAULT '',
    "acknowledged_on" DATE,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "handover_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handover_schedule_lines" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "room" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "condition" "ConditionRating" NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "handover_schedule_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_company_id_item_no_key" ON "inventory_items"("company_id", "item_no");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_company_id_code_key" ON "inventory_items"("company_id", "code");

-- CreateIndex
CREATE INDEX "inventory_items_company_id_asset_id_idx" ON "inventory_items"("company_id", "asset_id");

-- CreateIndex
CREATE INDEX "inventory_movements_company_id_item_id_created_at_idx" ON "inventory_movements"("company_id", "item_id", "created_at");

-- CreateIndex
CREATE INDEX "inventory_movements_work_order_id_idx" ON "inventory_movements"("work_order_id");

-- CreateIndex
CREATE INDEX "inventory_adjustments_company_id_status_idx" ON "inventory_adjustments"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_counts_company_id_ref_key" ON "inventory_counts"("company_id", "ref");

-- CreateIndex
CREATE INDEX "inventory_counts_company_id_status_idx" ON "inventory_counts"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_count_lines_count_id_item_id_key" ON "inventory_count_lines"("count_id", "item_id");

-- CreateIndex
CREATE INDEX "inventory_count_lines_company_id_count_id_idx" ON "inventory_count_lines"("company_id", "count_id");

-- CreateIndex
CREATE UNIQUE INDEX "handover_schedules_lease_id_kind_key" ON "handover_schedules"("lease_id", "kind");

-- CreateIndex
CREATE INDEX "handover_schedules_company_id_idx" ON "handover_schedules"("company_id");

-- CreateIndex
CREATE INDEX "handover_schedule_lines_company_id_schedule_id_idx" ON "handover_schedule_lines"("company_id", "schedule_id");

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_custodian_id_fkey" FOREIGN KEY ("custodian_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_count_id_fkey" FOREIGN KEY ("count_id") REFERENCES "inventory_counts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_schedules" ADD CONSTRAINT "handover_schedules_lease_id_fkey" FOREIGN KEY ("lease_id") REFERENCES "leases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_schedule_lines" ADD CONSTRAINT "handover_schedule_lines_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "handover_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "work_order_materials" ADD COLUMN "inventory_item_id" TEXT;

ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_quantity" CHECK ("quantity" >= 0 AND ("reorder_level" IS NULL OR "reorder_level" >= 0) AND ("unit_cost_kobo" IS NULL OR "unit_cost_kobo" >= 0));
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_delta" CHECK (
  "balance_after" >= 0 AND (
    ("kind" IN ('RECEIPT','RETURN') AND "delta" > 0) OR
    ("kind" IN ('ISSUE','CONSUMPTION','LOSS','DAMAGE','DISPOSAL') AND "delta" < 0) OR
    ("kind" = 'TRANSFER' AND "delta" = 0) OR
    ("kind" = 'ADJUSTMENT' AND "delta" <> 0)));
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_delta" CHECK (
  ("kind" = 'ADJUSTMENT' AND "delta" <> 0) OR
  ("kind" IN ('LOSS','DAMAGE','DISPOSAL') AND "delta" < 0));
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_decision" CHECK (
  ("status" = 'PENDING' AND "decided_by_id" IS NULL) OR ("status" <> 'PENDING' AND "decided_by_id" IS NOT NULL));
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_qty" CHECK ("expected_qty" >= 0 AND ("counted_qty" IS NULL OR "counted_qty" >= 0));
ALTER TABLE "handover_schedule_lines" ADD CONSTRAINT "handover_schedule_lines_qty" CHECK ("quantity" >= 0);
ALTER TABLE "handover_schedules" ADD CONSTRAINT "handover_schedules_ack" CHECK (
  ("status" = 'DRAFT') OR ("status" = 'ACKNOWLEDGED' AND length("acknowledged_by") >= 2 AND "acknowledged_on" IS NOT NULL));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['inventory_items','inventory_movements','inventory_adjustments','inventory_counts','inventory_count_lines','handover_schedules','handover_schedule_lines']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL
                      USING (company_id = app_current_company())
                      WITH CHECK (company_id = app_current_company())', t);
  END LOOP;
END $$;

-- An acknowledged handover schedule is evidence of what was handed over. It can no longer change.
CREATE FUNCTION handover_lines_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sid text;
BEGIN
  sid := COALESCE(NEW.schedule_id, OLD.schedule_id);
  IF EXISTS (SELECT 1 FROM handover_schedules WHERE id = sid AND status = 'ACKNOWLEDGED') THEN
    RAISE EXCEPTION 'An acknowledged handover schedule cannot be changed' USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER handover_lines_frozen BEFORE INSERT OR UPDATE OR DELETE ON handover_schedule_lines
  FOR EACH ROW EXECUTE FUNCTION handover_lines_frozen();

CREATE FUNCTION handover_schedule_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'ACKNOWLEDGED' THEN
    RAISE EXCEPTION 'An acknowledged handover schedule cannot be changed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER handover_schedule_frozen BEFORE UPDATE ON handover_schedules
  FOR EACH ROW EXECUTE FUNCTION handover_schedule_frozen();
