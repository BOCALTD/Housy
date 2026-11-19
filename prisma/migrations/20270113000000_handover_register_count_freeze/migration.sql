-- Move-in and move-out lines can be items from the property's inventory register; the register is updated from a handover once.
ALTER TABLE "handover_schedules" ADD COLUMN "register_updated_at" TIMESTAMP(3);
ALTER TABLE "handover_schedule_lines" ADD COLUMN "item_id" TEXT;
ALTER TABLE "handover_schedule_lines" ADD CONSTRAINT "handover_schedule_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "handover_schedule_lines_item_id_idx" ON "handover_schedule_lines"("item_id");

-- A stock count freezes its items: no movement is written for an item in a count that is open or waiting for approval,
-- except the count's own corrections when it is approved. The application checks first and says so plainly; this is the backstop.
CREATE INDEX "inventory_count_lines_item_id_idx" ON "inventory_count_lines"("item_id");

CREATE OR REPLACE FUNCTION inventory_movement_not_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE frozen_ref TEXT;
BEGIN
  IF NEW.count_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT c.ref INTO frozen_ref
    FROM inventory_count_lines l JOIN inventory_counts c ON c.id = l.count_id
   WHERE l.item_id = NEW.item_id AND c.status IN ('OPEN', 'SUBMITTED')
   LIMIT 1;
  IF frozen_ref IS NOT NULL THEN
    RAISE EXCEPTION 'This item is being counted in %. Stock does not move until that count is approved or cancelled.', frozen_ref
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER inventory_movements_count_freeze BEFORE INSERT ON "inventory_movements"
  FOR EACH ROW EXECUTE FUNCTION inventory_movement_not_frozen();

-- An acknowledged schedule stays unchangeable, except for recording, once, that the register was updated from it.
CREATE OR REPLACE FUNCTION handover_schedule_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'ACKNOWLEDGED' THEN
    IF OLD.register_updated_at IS NULL AND NEW.register_updated_at IS NOT NULL
       AND (to_jsonb(NEW) - 'register_updated_at') = (to_jsonb(OLD) - 'register_updated_at') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'An acknowledged handover schedule cannot be changed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
