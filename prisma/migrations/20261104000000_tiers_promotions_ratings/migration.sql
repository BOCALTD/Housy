-- Phase 11: perks tiers, promotions with a reviewed price, and the platform rating prompt.

-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('BASIC', 'SILVER', 'GOLD');

-- CreateEnum
CREATE TYPE "PromoStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "PromoPaymentStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'VERIFIED');

-- CreateEnum
CREATE TYPE "PromoTheme" AS ENUM ('RED', 'GOLD', 'GREEN', 'PURPLE', 'BLUE');

-- CreateEnum
CREATE TYPE "RatingStatus" AS ENUM ('NEW', 'REVIEWED', 'ACTIONED');

-- CreateTable
CREATE TABLE "company_tiers" (
    "company_id" TEXT NOT NULL,
    "tier" "PlanTier" NOT NULL,
    "valid_until" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_tiers_pkey" PRIMARY KEY ("company_id")
);

-- CreateTable
CREATE TABLE "promo_campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT NOT NULL DEFAULT '',
    "theme" "PromoTheme" NOT NULL DEFAULT 'RED',
    "starts_on" TIMESTAMP(3) NOT NULL,
    "ends_on" TIMESTAMP(3) NOT NULL,
    "fee_kobo" BIGINT NOT NULL DEFAULT 0,
    "max_discount_pct" INTEGER NOT NULL DEFAULT 60,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_entries" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "original_price_kobo" BIGINT NOT NULL,
    "promo_price_kobo" BIGINT NOT NULL,
    "status" "PromoStatus" NOT NULL DEFAULT 'REQUESTED',
    "review_note" TEXT NOT NULL DEFAULT '',
    "requested_by_id" TEXT NOT NULL,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_payments" (
    "id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "tier_at_request" "PlanTier" NOT NULL,
    "fee_kobo" BIGINT NOT NULL,
    "status" "PromoPaymentStatus" NOT NULL,
    "reference" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "verified_by_id" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_ratings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "overall" INTEGER NOT NULL,
    "ease_score" INTEGER,
    "trust_score" INTEGER,
    "support_score" INTEGER,
    "suggestion" TEXT NOT NULL DEFAULT '',
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "user_kind" TEXT NOT NULL,
    "status" "RatingStatus" NOT NULL DEFAULT 'NEW',
    "admin_note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_state" (
    "user_id" TEXT NOT NULL,
    "last_rated_at" TIMESTAMP(3),
    "snoozed_until" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feedback_state_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX "promo_campaigns_active_starts_on_ends_on_idx" ON "promo_campaigns"("active", "starts_on", "ends_on");

-- CreateIndex
CREATE UNIQUE INDEX "promo_entries_ref_key" ON "promo_entries"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "promo_entries_campaign_id_listing_id_key" ON "promo_entries"("campaign_id", "listing_id");

-- CreateIndex
CREATE INDEX "promo_entries_company_id_status_idx" ON "promo_entries"("company_id", "status");

-- CreateIndex
CREATE INDEX "promo_entries_listing_id_status_idx" ON "promo_entries"("listing_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "promo_payments_entry_id_key" ON "promo_payments"("entry_id");

-- CreateIndex
CREATE INDEX "promo_payments_company_id_status_idx" ON "promo_payments"("company_id", "status");

-- CreateIndex
CREATE INDEX "platform_ratings_created_at_idx" ON "platform_ratings"("created_at");

-- CreateIndex
CREATE INDEX "platform_ratings_user_id_created_at_idx" ON "platform_ratings"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "promo_entries" ADD CONSTRAINT "promo_entries_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "promo_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_payments" ADD CONSTRAINT "promo_payments_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "promo_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "subscription_plans" ADD COLUMN "tier" "PlanTier" NOT NULL DEFAULT 'BASIC';

-- The plan tables already enforce row-level security, so the seed runs as the platform administrator.
SELECT set_config('app.platform_admin', 'on', false);

-- Silver and Gold plans for companies. Prices are left unset, as with the other plans: the platform administrator sets them.
INSERT INTO subscription_plans (id, code, name, audience, price_kobo, billing_period, grace_days, read_only_days, sort_order, tier, updated_at) VALUES
  (gen_random_uuid()::text, 'company-silver', 'Silver', 'COMPANY', NULL, 'MONTHLY', 7, 30, 52, 'SILVER', now()),
  (gen_random_uuid()::text, 'company-gold', 'Gold', 'COMPANY', NULL, 'MONTHLY', 7, 30, 54, 'GOLD', now());
INSERT INTO plan_entitlements (id, plan_id, key, "limit")
  SELECT gen_random_uuid()::text, p.id, e.key, e.lim FROM subscription_plans p JOIN (VALUES
    ('company-silver', 'COLLAB_COMPANY', 10), ('company-silver', 'CONTACT_DETAILS', NULL),
    ('company-gold', 'COLLAB_COMPANY', NULL), ('company-gold', 'CONTACT_DETAILS', NULL), ('company-gold', 'BULK_MESSAGING', NULL)
  ) AS e(code, key, lim) ON e.code = p.code;

SELECT set_config('app.platform_admin', '', false);

-- ---------- Rules the database holds ----------
ALTER TABLE "promo_campaigns" ADD CONSTRAINT promo_campaign_window CHECK (ends_on >= starts_on);
ALTER TABLE "promo_campaigns" ADD CONSTRAINT promo_campaign_discount CHECK (max_discount_pct BETWEEN 1 AND 90);
ALTER TABLE "promo_campaigns" ADD CONSTRAINT promo_campaign_fee CHECK (fee_kobo >= 0);
ALTER TABLE "promo_entries" ADD CONSTRAINT promo_entry_cheaper CHECK (promo_price_kobo > 0 AND promo_price_kobo < original_price_kobo);
ALTER TABLE "promo_entries" ADD CONSTRAINT promo_entry_reviewed CHECK (status NOT IN ('APPROVED', 'REJECTED') OR (reviewed_by_id IS NOT NULL AND reviewed_at IS NOT NULL));
ALTER TABLE "promo_entries" ADD CONSTRAINT promo_entry_rejected_reason CHECK (status <> 'REJECTED' OR char_length(btrim(review_note)) > 0);
ALTER TABLE "promo_payments" ADD CONSTRAINT promo_payment_verified CHECK (status <> 'VERIFIED' OR (verified_by_id IS NOT NULL AND verified_at IS NOT NULL AND char_length(btrim(reference)) >= 4));
ALTER TABLE "promo_payments" ADD CONSTRAINT promo_payment_free CHECK (status <> 'NOT_REQUIRED' OR fee_kobo = 0 OR tier_at_request <> 'BASIC');
ALTER TABLE "platform_ratings" ADD CONSTRAINT rating_overall CHECK (overall BETWEEN 1 AND 5);
ALTER TABLE "platform_ratings" ADD CONSTRAINT rating_parts CHECK ((ease_score IS NULL OR ease_score BETWEEN 1 AND 5) AND (trust_score IS NULL OR trust_score BETWEEN 1 AND 5) AND (support_score IS NULL OR support_score BETWEEN 1 AND 5));
ALTER TABLE "platform_ratings" ADD CONSTRAINT rating_suggestion_len CHECK (char_length(suggestion) <= 2000);

-- ---------- Row-level security ----------
-- A company's tier and the campaigns are public, because the badge and the sale are. Everything about who asked, who paid and what was
-- said is private to the company and the platform administrator.
ALTER TABLE "company_tiers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_tiers" FORCE ROW LEVEL SECURITY;
CREATE POLICY public_read ON "company_tiers" FOR SELECT USING (true);
CREATE POLICY admin_write ON "company_tiers" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "promo_campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "promo_campaigns" FORCE ROW LEVEL SECURITY;
CREATE POLICY public_read ON "promo_campaigns" FOR SELECT USING (true);
CREATE POLICY admin_write ON "promo_campaigns" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "promo_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "promo_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_visible ON "promo_entries" FOR SELECT USING (status = 'APPROVED' OR company_id = app_current_company() OR app_platform_admin());
CREATE POLICY request_own ON "promo_entries" FOR INSERT WITH CHECK ((company_id = app_current_company() AND status = 'REQUESTED') OR app_platform_admin());
CREATE POLICY withdraw_own ON "promo_entries" FOR UPDATE USING ((company_id = app_current_company() AND status = 'REQUESTED') OR app_platform_admin()) WITH CHECK ((company_id = app_current_company() AND status IN ('REQUESTED', 'WITHDRAWN')) OR app_platform_admin());

ALTER TABLE "promo_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "promo_payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_own ON "promo_payments" FOR SELECT USING (company_id = app_current_company() OR app_platform_admin());
CREATE POLICY request_own ON "promo_payments" FOR INSERT WITH CHECK ((company_id = app_current_company() AND status IN ('PENDING', 'NOT_REQUIRED')) OR app_platform_admin());
CREATE POLICY admin_update ON "promo_payments" FOR UPDATE USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "platform_ratings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_ratings" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_own ON "platform_ratings" FOR SELECT USING (user_id = app_current_user() OR app_platform_admin());
CREATE POLICY give_own ON "platform_ratings" FOR INSERT WITH CHECK ((user_id = app_current_user() AND status = 'NEW') OR app_platform_admin());
CREATE POLICY admin_update ON "platform_ratings" FOR UPDATE USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "feedback_state" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "feedback_state" FORCE ROW LEVEL SECURITY;
CREATE POLICY own ON "feedback_state" FOR ALL USING (user_id = app_current_user() OR app_platform_admin()) WITH CHECK (user_id = app_current_user() OR app_platform_admin());
