-- AlterTable
ALTER TABLE "handover_schedules" ADD COLUMN     "charges_deducted_at" TIMESTAMP(3),
ADD COLUMN     "deposit_entry_id" TEXT;

-- CreateTable
CREATE TABLE "handover_charges" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "lease_id" TEXT NOT NULL,
    "line_key" TEXT NOT NULL,
    "room" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "amount_kobo" BIGINT NOT NULL,
    "suggested_kobo" BIGINT,
    "note" TEXT NOT NULL DEFAULT '',
    "set_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "handover_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "handover_charges_company_id_idx" ON "handover_charges"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "handover_charges_lease_id_line_key_key" ON "handover_charges"("lease_id", "line_key");

-- AddForeignKey
ALTER TABLE "handover_charges" ADD CONSTRAINT "handover_charges_lease_id_fkey" FOREIGN KEY ("lease_id") REFERENCES "leases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "handover_charges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "handover_charges" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "handover_charges" FOR ALL USING (company_id = app_current_company()) WITH CHECK (company_id = app_current_company());
ALTER TABLE "handover_charges" ADD CONSTRAINT "handover_charges_amount" CHECK ("amount_kobo" >= 0 AND "quantity" >= 0);

-- An acknowledged schedule stays frozen, except for the two one-time stamps: the register update, and the deduction of the value of
-- lost or damaged items from the deposit (with its deposit entry).
CREATE OR REPLACE FUNCTION handover_schedule_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'ACKNOWLEDGED' THEN
    IF OLD.register_updated_at IS NULL AND NEW.register_updated_at IS NOT NULL
       AND (to_jsonb(NEW) - 'register_updated_at') = (to_jsonb(OLD) - 'register_updated_at') THEN
      RETURN NEW;
    END IF;
    IF OLD.charges_deducted_at IS NULL AND NEW.charges_deducted_at IS NOT NULL AND NEW.deposit_entry_id IS NOT NULL
       AND (to_jsonb(NEW) - 'charges_deducted_at' - 'deposit_entry_id') = (to_jsonb(OLD) - 'charges_deducted_at' - 'deposit_entry_id') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'An acknowledged handover schedule cannot be changed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- Once deducted from the deposit, the values are a record: they cannot be changed or removed.
CREATE FUNCTION handover_charges_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lid text;
BEGIN
  lid := COALESCE(NEW.lease_id, OLD.lease_id);
  IF EXISTS (SELECT 1 FROM handover_schedules WHERE lease_id = lid AND kind = 'MOVE_OUT' AND charges_deducted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'These values were deducted from the deposit and cannot be changed' USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER handover_charges_frozen BEFORE INSERT OR UPDATE OR DELETE ON handover_charges
  FOR EACH ROW EXECUTE FUNCTION handover_charges_frozen();
