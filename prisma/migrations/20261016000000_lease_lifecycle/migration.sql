-- Phase 5b: lease lifecycle. Renewals, notices, move-in/move-out handover and closure.

ALTER TABLE "leases" ADD COLUMN "closed_on" DATE;
ALTER TABLE "leases" ADD COLUMN "close_reason" TEXT NOT NULL DEFAULT '';
ALTER TABLE "leases" ADD COLUMN "renewed_from_id" TEXT;
CREATE UNIQUE INDEX "leases_renewed_from_id_key" ON "leases"("renewed_from_id");
ALTER TABLE "leases" ADD CONSTRAINT "leases_renewed_from_id_fkey" FOREIGN KEY ("renewed_from_id") REFERENCES "leases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "RenewalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "NoticeParty" AS ENUM ('TENANT', 'LANDLORD');

-- CreateEnum
CREATE TYPE "HandoverKind" AS ENUM ('MOVE_IN', 'MOVE_OUT');

-- CreateTable
CREATE TABLE "lease_renewals" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "lease_id" TEXT NOT NULL,
    "proposed_start" DATE NOT NULL,
    "proposed_end" DATE NOT NULL,
    "proposed_rent_kobo" BIGINT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" "RenewalStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_id" TEXT NOT NULL,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT NOT NULL DEFAULT '',
    "new_lease_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lease_renewals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lease_notices" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "lease_id" TEXT NOT NULL,
    "given_by" "NoticeParty" NOT NULL,
    "given_on" DATE NOT NULL,
    "effective_on" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lease_notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lease_handovers" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "lease_id" TEXT NOT NULL,
    "kind" "HandoverKind" NOT NULL,
    "handover_on" DATE NOT NULL,
    "keys_count" INTEGER NOT NULL,
    "meter_readings" TEXT NOT NULL DEFAULT '',
    "condition_notes" TEXT NOT NULL,
    "issues" TEXT NOT NULL DEFAULT '',
    "acknowledged_by" TEXT NOT NULL,
    "recorded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lease_handovers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lease_renewals_new_lease_id_key" ON "lease_renewals"("new_lease_id");

-- CreateIndex
CREATE INDEX "lease_renewals_company_id_lease_id_idx" ON "lease_renewals"("company_id", "lease_id");

-- CreateIndex
CREATE INDEX "lease_notices_company_id_lease_id_idx" ON "lease_notices"("company_id", "lease_id");

-- CreateIndex
CREATE UNIQUE INDEX "lease_handovers_lease_id_kind_key" ON "lease_handovers"("lease_id", "kind");

-- CreateIndex
CREATE INDEX "lease_handovers_company_id_idx" ON "lease_handovers"("company_id");

-- AddForeignKey
ALTER TABLE "lease_renewals" ADD CONSTRAINT "lease_renewals_lease_id_fkey" FOREIGN KEY ("lease_id") REFERENCES "leases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_notices" ADD CONSTRAINT "lease_notices_lease_id_fkey" FOREIGN KEY ("lease_id") REFERENCES "leases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_handovers" ADD CONSTRAINT "lease_handovers_lease_id_fkey" FOREIGN KEY ("lease_id") REFERENCES "leases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "lease_renewals" ADD CONSTRAINT "lease_renewals_period" CHECK ("proposed_end" > "proposed_start");
ALTER TABLE "lease_renewals" ADD CONSTRAINT "lease_renewals_rent_positive" CHECK ("proposed_rent_kobo" > 0);
ALTER TABLE "lease_notices" ADD CONSTRAINT "lease_notices_dates" CHECK ("effective_on" >= "given_on");
ALTER TABLE "lease_handovers" ADD CONSTRAINT "lease_handovers_keys" CHECK ("keys_count" >= 0);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lease_renewals','lease_notices','lease_handovers']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL
                      USING (company_id = app_current_company())
                      WITH CHECK (company_id = app_current_company())', t);
  END LOOP;
END $$;
