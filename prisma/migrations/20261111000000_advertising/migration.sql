-- CreateEnum
CREATE TYPE "AdPlacement" AS ENUM ('HOME_FEATURED', 'SEARCH_TOP');

-- CreateEnum
CREATE TYPE "AdStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'PAUSED', 'SUSPENDED', 'ENDED');

-- CreateTable
CREATE TABLE "ad_campaigns" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "owner_kind" "SubscriptionOwner" NOT NULL,
    "owner_user_id" TEXT,
    "owner_company_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "placement" "AdPlacement" NOT NULL,
    "headline" TEXT NOT NULL DEFAULT '',
    "starts_on" TIMESTAMP(3) NOT NULL,
    "ends_on" TIMESTAMP(3) NOT NULL,
    "budget_kobo" BIGINT NOT NULL,
    "daily_cap_kobo" BIGINT,
    "cpc_kobo" BIGINT NOT NULL,
    "status" "AdStatus" NOT NULL DEFAULT 'DRAFT',
    "review_note" TEXT NOT NULL DEFAULT '',
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "suspended_by" TEXT NOT NULL DEFAULT '',
    "suspend_reason" TEXT NOT NULL DEFAULT '',
    "suspended_at" TIMESTAMP(3),
    "ended_reason" TEXT NOT NULL DEFAULT '',
    "invoice_id" TEXT,
    "funded_kobo" BIGINT NOT NULL DEFAULT 0,
    "spent_kobo" BIGINT NOT NULL DEFAULT 0,
    "posted_kobo" BIGINT NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "billed_clicks" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_days" (
    "campaign_id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "billed_clicks" INTEGER NOT NULL DEFAULT 0,
    "spent_kobo" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "ad_days_pkey" PRIMARY KEY ("campaign_id", "day")
);

-- CreateTable
CREATE TABLE "ad_clicks" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "viewer_key" TEXT NOT NULL,
    "user_id" TEXT,
    "billed" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_view_keys" (
    "listing_id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "viewer_key" TEXT NOT NULL,
    "via" TEXT NOT NULL,

    CONSTRAINT "listing_view_keys_pkey" PRIMARY KEY ("listing_id", "day", "viewer_key")
);

-- CreateIndex
CREATE UNIQUE INDEX "ad_campaigns_ref_key" ON "ad_campaigns"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "ad_campaigns_invoice_id_key" ON "ad_campaigns"("invoice_id");

-- CreateIndex
CREATE INDEX "ad_campaigns_status_placement_idx" ON "ad_campaigns"("status", "placement");

-- CreateIndex
CREATE INDEX "ad_campaigns_owner_company_id_created_at_idx" ON "ad_campaigns"("owner_company_id", "created_at");

-- CreateIndex
CREATE INDEX "ad_campaigns_owner_user_id_created_at_idx" ON "ad_campaigns"("owner_user_id", "created_at");

-- CreateIndex
CREATE INDEX "ad_campaigns_listing_id_idx" ON "ad_campaigns"("listing_id");

-- CreateIndex
CREATE INDEX "ad_clicks_campaign_id_viewer_key_created_at_idx" ON "ad_clicks"("campaign_id", "viewer_key", "created_at");

-- CreateIndex
CREATE INDEX "ad_clicks_campaign_id_created_at_idx" ON "ad_clicks"("campaign_id", "created_at");

-- CreateIndex
CREATE INDEX "listing_view_keys_listing_id_day_idx" ON "listing_view_keys"("listing_id", "day");

-- AddForeignKey
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_days" ADD CONSTRAINT "ad_days_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "ad_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_clicks" ADD CONSTRAINT "ad_clicks_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "ad_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "enquiries" ADD COLUMN "ad_campaign_id" TEXT;

-- CreateIndex
CREATE INDEX "enquiries_ad_campaign_id_idx" ON "enquiries"("ad_campaign_id");

-- Rules the application cannot be trusted to keep alone. Spending can never pass what was paid in, whatever happens at the same moment.
ALTER TABLE "ad_campaigns" ADD CONSTRAINT ad_owner CHECK ((owner_user_id IS NOT NULL) <> (owner_company_id IS NOT NULL) AND (owner_kind = 'USER') = (owner_user_id IS NOT NULL));
ALTER TABLE "ad_campaigns" ADD CONSTRAINT ad_terms CHECK (budget_kobo > 0 AND budget_kobo <= 500000000 AND cpc_kobo > 0 AND cpc_kobo <= budget_kobo AND (daily_cap_kobo IS NULL OR (daily_cap_kobo >= cpc_kobo AND daily_cap_kobo <= budget_kobo)) AND ends_on >= starts_on AND char_length(btrim(name)) BETWEEN 1 AND 80 AND char_length(headline) <= 60);
ALTER TABLE "ad_campaigns" ADD CONSTRAINT ad_money CHECK (funded_kobo >= 0 AND spent_kobo >= 0 AND spent_kobo <= funded_kobo AND posted_kobo >= 0 AND posted_kobo <= spent_kobo AND impressions >= 0 AND clicks >= 0 AND billed_clicks >= 0 AND billed_clicks <= clicks);
ALTER TABLE "ad_campaigns" ADD CONSTRAINT ad_state CHECK ((status <> 'SUSPENDED' OR char_length(btrim(suspend_reason)) >= 5) AND (status NOT IN ('APPROVED', 'REJECTED') OR reviewed_by_id IS NOT NULL) AND char_length(review_note) <= 500 AND char_length(suspend_reason) <= 500);
ALTER TABLE "ad_days" ADD CONSTRAINT ad_day_counts CHECK (impressions >= 0 AND clicks >= 0 AND billed_clicks >= 0 AND spent_kobo >= 0 AND day ~ '^\d{4}-\d{2}-\d{2}$');
ALTER TABLE "listing_view_keys" ADD CONSTRAINT view_via CHECK (via IN ('ORGANIC', 'AD'));

-- Campaigns are visible to the people who run them and to the platform; only the platform's own checks write. Clicks, daily counters and visits are the platform's alone.
ALTER TABLE "ad_campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ad_campaigns" FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_read ON "ad_campaigns" FOR SELECT USING (owner_user_id = app_current_user() OR owner_company_id = app_current_company() OR app_platform_admin());
CREATE POLICY admin_write ON "ad_campaigns" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
ALTER TABLE "ad_days" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ad_days" FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_only ON "ad_days" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
ALTER TABLE "ad_clicks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ad_clicks" FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_only ON "ad_clicks" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
ALTER TABLE "listing_view_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "listing_view_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_only ON "listing_view_keys" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
