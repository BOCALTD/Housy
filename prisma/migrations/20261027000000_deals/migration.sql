-- CreateEnum
CREATE TYPE "DealType" AS ENUM ('SALE', 'RENT', 'LEASE');

-- CreateEnum
CREATE TYPE "DealStage" AS ENUM ('ENQUIRY', 'VIEWING', 'OFFER', 'NEGOTIATION', 'AGREED', 'LEGAL', 'COMPLETED');

-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('OPEN', 'ON_HOLD', 'DISPUTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DealEventKind" AS ENUM ('OPENED', 'STAGE', 'STATUS', 'REASSIGNED', 'VIEWING', 'OFFER', 'NOTE');

-- CreateEnum
CREATE TYPE "ViewingStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "OfferSide" AS ENUM ('CLIENT', 'OWNER');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('OPEN', 'COUNTERED', 'REJECTED', 'WITHDRAWN', 'ACCEPTANCE_REQUESTED', 'ACCEPTED');

-- CreateTable
CREATE TABLE "deals" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "type" "DealType" NOT NULL,
    "stage" "DealStage" NOT NULL DEFAULT 'ENQUIRY',
    "status" "DealStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "asset_id" TEXT NOT NULL,
    "listing_id" TEXT,
    "owner_id" TEXT NOT NULL,
    "asking_kobo" BIGINT NOT NULL,
    "agreed_kobo" BIGINT,
    "agreed_at" TIMESTAMP(3),
    "expected_close_on" DATE,
    "hold_reason" TEXT NOT NULL DEFAULT '',
    "dispute_reason" TEXT NOT NULL DEFAULT '',
    "disputed_by_id" TEXT,
    "disputed_at" TIMESTAMP(3),
    "dispute_outcome" TEXT NOT NULL DEFAULT '',
    "cancel_reason" TEXT NOT NULL DEFAULT '',
    "cancelled_by_id" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "completed_by_id" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_events" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "kind" "DealEventKind" NOT NULL,
    "from_stage" "DealStage",
    "to_stage" "DealStage",
    "from_status" "DealStatus",
    "to_status" "DealStatus",
    "summary" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "viewings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "meeting_point" TEXT NOT NULL DEFAULT '',
    "status" "ViewingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "outcome" TEXT NOT NULL DEFAULT '',
    "cancel_reason" TEXT NOT NULL DEFAULT '',
    "rescheduled_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "viewings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "side" "OfferSide" NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "conditions" TEXT NOT NULL DEFAULT '',
    "valid_until" DATE,
    "status" "OfferStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT NOT NULL DEFAULT '',
    "recorded_by_id" TEXT NOT NULL,
    "accept_requested_by_id" TEXT,
    "accept_requested_at" TIMESTAMP(3),
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deals_lead_id_key" ON "deals"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "deals_company_id_ref_key" ON "deals"("company_id", "ref");

-- CreateIndex
CREATE INDEX "deals_company_id_status_stage_idx" ON "deals"("company_id", "status", "stage");

-- CreateIndex
CREATE INDEX "deals_company_id_owner_id_idx" ON "deals"("company_id", "owner_id");

-- CreateIndex
CREATE INDEX "deals_client_id_idx" ON "deals"("client_id");

-- CreateIndex
CREATE INDEX "deals_asset_id_idx" ON "deals"("asset_id");

-- CreateIndex
CREATE INDEX "deal_events_deal_id_created_at_idx" ON "deal_events"("deal_id", "created_at");

-- CreateIndex
CREATE INDEX "viewings_company_id_agent_id_starts_at_idx" ON "viewings"("company_id", "agent_id", "starts_at");

-- CreateIndex
CREATE INDEX "viewings_company_id_asset_id_starts_at_idx" ON "viewings"("company_id", "asset_id", "starts_at");

-- CreateIndex
CREATE INDEX "viewings_deal_id_idx" ON "viewings"("deal_id");

-- CreateIndex
CREATE INDEX "offers_deal_id_created_at_idx" ON "offers"("deal_id", "created_at");

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_events" ADD CONSTRAINT "deal_events_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viewings" ADD CONSTRAINT "viewings_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Rules the database enforces whatever the application does.
ALTER TABLE "deals" ADD CONSTRAINT deals_asking_positive CHECK (asking_kobo > 0);
ALTER TABLE "deals" ADD CONSTRAINT deals_agreed_positive CHECK (agreed_kobo IS NULL OR agreed_kobo > 0);
ALTER TABLE "deals" ADD CONSTRAINT deals_agreed_price_set CHECK (stage NOT IN ('AGREED', 'LEGAL', 'COMPLETED') OR agreed_kobo IS NOT NULL);
ALTER TABLE "deals" ADD CONSTRAINT deals_completed_matches_stage CHECK ((status = 'COMPLETED') = (stage = 'COMPLETED'));
ALTER TABLE "deals" ADD CONSTRAINT deals_completed_has_who CHECK (status <> 'COMPLETED' OR (completed_at IS NOT NULL AND completed_by_id IS NOT NULL));
ALTER TABLE "deals" ADD CONSTRAINT deals_cancelled_has_reason CHECK (status <> 'CANCELLED' OR (length(btrim(cancel_reason)) >= 3 AND cancelled_at IS NOT NULL AND cancelled_by_id IS NOT NULL));
ALTER TABLE "deals" ADD CONSTRAINT deals_disputed_has_reason CHECK (status <> 'DISPUTED' OR (length(btrim(dispute_reason)) >= 3 AND disputed_by_id IS NOT NULL));
ALTER TABLE "deals" ADD CONSTRAINT deals_hold_has_reason CHECK (status <> 'ON_HOLD' OR length(btrim(hold_reason)) >= 3);
ALTER TABLE "viewings" ADD CONSTRAINT viewings_ends_after_start CHECK (ends_at > starts_at);
ALTER TABLE "viewings" ADD CONSTRAINT viewings_cancel_has_reason CHECK (status <> 'CANCELLED' OR length(btrim(cancel_reason)) >= 3);
ALTER TABLE "offers" ADD CONSTRAINT offers_amount_positive CHECK (amount_kobo > 0);
ALTER TABLE "offers" ADD CONSTRAINT offers_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id);
ALTER TABLE "offers" ADD CONSTRAINT offers_acceptance_requested_by CHECK (status NOT IN ('ACCEPTANCE_REQUESTED', 'ACCEPTED') OR accept_requested_by_id IS NOT NULL);
ALTER TABLE "offers" ADD CONSTRAINT offers_accepted_by_a_second_person CHECK (status <> 'ACCEPTED' OR (decided_by_id IS NOT NULL AND decided_by_id <> accept_requested_by_id));
ALTER TABLE "offers" ADD CONSTRAINT offers_rejected_has_reason CHECK (status <> 'REJECTED' OR length(btrim(decision_note)) >= 3);

-- Row-level security: a company sees only its own deals.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['deals','deal_events','viewings','offers']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL
                      USING (company_id = app_current_company())
                      WITH CHECK (company_id = app_current_company())', t);
  END LOOP;
END $$;
