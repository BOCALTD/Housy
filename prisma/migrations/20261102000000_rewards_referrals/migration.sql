-- CreateEnum
CREATE TYPE "RewardProgramme" AS ENUM ('REFERRAL', 'VACANCY');

-- CreateEnum
CREATE TYPE "RewardEvent" AS ENUM ('REFERRAL_REGISTERED', 'REFERRAL_LISTING_PUBLISHED', 'REFERRAL_SUBSCRIBED', 'REFERRAL_CUSTOM', 'VACANCY_VERIFIED', 'VACANCY_LISTED', 'VACANCY_TRANSACTION');

-- CreateEnum
CREATE TYPE "RewardStatus" AS ENUM ('NOT_ELIGIBLE', 'UNDER_REVIEW', 'ELIGIBLE', 'APPROVED', 'PAYABLE', 'PAID', 'REJECTED', 'CANCELLED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');

-- CreateEnum
CREATE TYPE "ReferralAudience" AS ENUM ('SEEKER', 'OWNER', 'AGENT', 'COMPANY', 'DEVELOPER', 'VENDOR', 'SUBSCRIBER', 'LISTING', 'OTHER');

-- CreateEnum
CREATE TYPE "AttributionStatus" AS ENUM ('REGISTERED', 'QUALIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ReviewState" AS ENUM ('CLEAR', 'FLAGGED', 'CLEARED', 'CONFIRMED_ABUSE');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UPHELD', 'DENIED');

-- CreateEnum
CREATE TYPE "DisputeSubject" AS ENUM ('REWARD', 'VACANCY_REPORT');

-- CreateTable
CREATE TABLE "reward_policies" (
    "id" TEXT NOT NULL,
    "programme" "RewardProgramme" NOT NULL,
    "event" "RewardEvent" NOT NULL,
    "campaign_id" TEXT,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "hold_days" INTEGER NOT NULL DEFAULT 14,
    "per_person_limit" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "terms" TEXT NOT NULL DEFAULT '',
    "retired_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_budgets" (
    "id" TEXT NOT NULL,
    "programme" "RewardProgramme" NOT NULL,
    "month" TEXT NOT NULL,
    "limit_kobo" BIGINT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rewards" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "programme" "RewardProgramme" NOT NULL,
    "event" "RewardEvent" NOT NULL,
    "policy_id" TEXT,
    "policy_version" INTEGER,
    "amount_kobo" BIGINT NOT NULL,
    "status" "RewardStatus" NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "flag" TEXT NOT NULL DEFAULT '',
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "source_label" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "approved_at" TIMESTAMP(3),
    "approved_by_id" TEXT,
    "payable_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "payout_id" TEXT,

    CONSTRAINT "rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_ledger" (
    "id" TEXT NOT NULL,
    "reward_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "from_status" "RewardStatus",
    "to_status" "RewardStatus" NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "actor_id" TEXT,
    "actor_name" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_payouts" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "method" TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
    "reference" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "failure_reason" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT NOT NULL,
    "created_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_by_id" TEXT,
    "verified_at" TIMESTAMP(3),

    CONSTRAINT "reward_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_restrictions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "set_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lifted_at" TIMESTAMP(3),
    "lifted_by_id" TEXT,

    CONSTRAINT "reward_restrictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_disputes" (
    "id" TEXT NOT NULL,
    "subject_type" "DisputeSubject" NOT NULL,
    "subject_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT NOT NULL DEFAULT '',
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "audience" "ReferralAudience" NOT NULL,
    "event" "RewardEvent" NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "starts_on" TIMESTAMP(3) NOT NULL,
    "ends_on" TIMESTAMP(3),
    "attribution_days" INTEGER NOT NULL DEFAULT 30,
    "qualify_within_days" INTEGER NOT NULL DEFAULT 60,
    "max_rewards_per_referrer" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_codes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_attributions" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "code_id" TEXT NOT NULL,
    "referrer_id" TEXT NOT NULL,
    "referred_user_id" TEXT NOT NULL,
    "referred_name" TEXT NOT NULL,
    "referred_company_id" TEXT,
    "campaign_id" TEXT NOT NULL,
    "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "AttributionStatus" NOT NULL DEFAULT 'REGISTERED',
    "signals" TEXT NOT NULL DEFAULT '',
    "review_state" "ReviewState" NOT NULL DEFAULT 'CLEAR',
    "review_note" TEXT NOT NULL DEFAULT '',
    "reviewed_by_id" TEXT,
    "reject_reason" TEXT NOT NULL DEFAULT '',
    "qualified_at" TIMESTAMP(3),

    CONSTRAINT "referral_attributions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reward_policies_programme_event_active_idx" ON "reward_policies"("programme", "event", "active");

-- CreateIndex
CREATE UNIQUE INDEX "reward_budgets_programme_month_key" ON "reward_budgets"("programme", "month");

-- CreateIndex
CREATE UNIQUE INDEX "rewards_ref_key" ON "rewards"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "rewards_source_type_source_id_event_key" ON "rewards"("source_type", "source_id", "event");

-- CreateIndex
CREATE INDEX "rewards_user_id_status_idx" ON "rewards"("user_id", "status");

-- CreateIndex
CREATE INDEX "rewards_status_payable_at_idx" ON "rewards"("status", "payable_at");

-- CreateIndex
CREATE INDEX "reward_ledger_reward_id_created_at_idx" ON "reward_ledger"("reward_id", "created_at");

-- CreateIndex
CREATE INDEX "reward_ledger_user_id_created_at_idx" ON "reward_ledger"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reward_payouts_ref_key" ON "reward_payouts"("ref");

-- CreateIndex
CREATE INDEX "reward_payouts_user_id_idx" ON "reward_payouts"("user_id");

-- CreateIndex
CREATE INDEX "reward_payouts_status_idx" ON "reward_payouts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "reward_restrictions_user_id_key" ON "reward_restrictions"("user_id");

-- CreateIndex
CREATE INDEX "reward_disputes_status_idx" ON "reward_disputes"("status");

-- CreateIndex
CREATE INDEX "reward_disputes_subject_type_subject_id_idx" ON "reward_disputes"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "referral_campaigns_active_audience_idx" ON "referral_campaigns"("active", "audience");

-- CreateIndex
CREATE UNIQUE INDEX "referral_codes_user_id_key" ON "referral_codes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "referral_codes_code_key" ON "referral_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "referral_attributions_ref_key" ON "referral_attributions"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "referral_attributions_referred_user_id_key" ON "referral_attributions"("referred_user_id");

-- CreateIndex
CREATE INDEX "referral_attributions_referrer_id_idx" ON "referral_attributions"("referrer_id");

-- CreateIndex
CREATE INDEX "referral_attributions_campaign_id_status_idx" ON "referral_attributions"("campaign_id", "status");

-- CreateIndex
CREATE INDEX "referral_attributions_referred_company_id_idx" ON "referral_attributions"("referred_company_id");

-- AddForeignKey
ALTER TABLE "reward_ledger" ADD CONSTRAINT "reward_ledger_reward_id_fkey" FOREIGN KEY ("reward_id") REFERENCES "rewards"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------- Rules the application also checks, kept here so no path can bypass them ----------
ALTER TABLE "reward_policies" ADD CONSTRAINT reward_policies_amount CHECK (amount_kobo >= 0 AND hold_days BETWEEN 0 AND 365 AND version >= 1);
ALTER TABLE "reward_policies" ADD CONSTRAINT reward_policies_limit CHECK (per_person_limit IS NULL OR per_person_limit >= 1);
ALTER TABLE "reward_budgets" ADD CONSTRAINT reward_budgets_limit CHECK (limit_kobo >= 0 AND month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "rewards" ADD CONSTRAINT rewards_amount CHECK (amount_kobo >= 0);
ALTER TABLE "rewards" ADD CONSTRAINT rewards_paid_has_payout CHECK (status <> 'PAID' OR (paid_at IS NOT NULL AND payout_id IS NOT NULL));
ALTER TABLE "rewards" ADD CONSTRAINT rewards_approved_has_approver CHECK (status NOT IN ('APPROVED', 'PAYABLE', 'PAID') OR (approved_at IS NOT NULL AND approved_by_id IS NOT NULL AND payable_at IS NOT NULL));
ALTER TABLE "rewards" ADD CONSTRAINT rewards_reason_when_closed CHECK (status NOT IN ('NOT_ELIGIBLE', 'REJECTED', 'CANCELLED') OR char_length(btrim(reason)) > 0);
ALTER TABLE "reward_payouts" ADD CONSTRAINT reward_payouts_amount CHECK (amount_kobo > 0);
ALTER TABLE "reward_payouts" ADD CONSTRAINT reward_payouts_paid_verified CHECK (status <> 'PAID' OR (verified_by_id IS NOT NULL AND verified_at IS NOT NULL AND verified_by_id <> created_by_id AND char_length(btrim(reference)) >= 4));
ALTER TABLE "reward_payouts" ADD CONSTRAINT reward_payouts_failed_why CHECK (status <> 'FAILED' OR char_length(btrim(failure_reason)) > 0);
ALTER TABLE "reward_restrictions" ADD CONSTRAINT reward_restrictions_lift CHECK ((lifted_at IS NULL) = (lifted_by_id IS NULL));
ALTER TABLE "reward_disputes" ADD CONSTRAINT reward_disputes_resolved CHECK (status = 'OPEN' OR (resolved_by_id IS NOT NULL AND resolved_at IS NOT NULL AND char_length(btrim(resolution)) > 0));
ALTER TABLE "reward_disputes" ADD CONSTRAINT reward_disputes_reason CHECK (char_length(btrim(reason)) >= 10);
ALTER TABLE "referral_campaigns" ADD CONSTRAINT referral_campaigns_window CHECK (attribution_days BETWEEN 1 AND 365 AND qualify_within_days BETWEEN 1 AND 730 AND (ends_on IS NULL OR ends_on >= starts_on) AND (max_rewards_per_referrer IS NULL OR max_rewards_per_referrer >= 1));
ALTER TABLE "referral_campaigns" ADD CONSTRAINT referral_campaigns_event CHECK (event IN ('REFERRAL_REGISTERED', 'REFERRAL_LISTING_PUBLISHED', 'REFERRAL_SUBSCRIBED', 'REFERRAL_CUSTOM'));
ALTER TABLE "referral_attributions" ADD CONSTRAINT referral_attributions_not_self CHECK (referrer_id <> referred_user_id);

-- ---------- Who may see and change what ----------
-- Rewards are written by the platform engine (and administrators). A person reads only their own.
-- The rules: policies and campaigns are public to signed-in people so the terms are transparent; everything else is private.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['reward_policies', 'referral_campaigns']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY read_signed_in ON %I FOR SELECT USING (app_current_user() IS NOT NULL OR app_platform_admin())', t);
    EXECUTE format('CREATE POLICY admin_write ON %I FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin())', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['rewards', 'reward_ledger', 'reward_payouts', 'reward_restrictions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY read_own ON %I FOR SELECT USING (user_id = app_current_user() OR app_platform_admin())', t);
    EXECUTE format('CREATE POLICY admin_write ON %I FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin())', t);
  END LOOP;
END $$;

ALTER TABLE "reward_budgets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reward_budgets" FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_only ON "reward_budgets" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "reward_disputes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reward_disputes" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_own ON "reward_disputes" FOR SELECT USING (user_id = app_current_user() OR app_platform_admin());
CREATE POLICY open_own ON "reward_disputes" FOR INSERT WITH CHECK (user_id = app_current_user() AND status = 'OPEN');
CREATE POLICY admin_update ON "reward_disputes" FOR UPDATE USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "referral_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "referral_codes" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_own ON "referral_codes" FOR SELECT USING (user_id = app_current_user() OR app_platform_admin());
CREATE POLICY create_own ON "referral_codes" FOR INSERT WITH CHECK (user_id = app_current_user() OR app_platform_admin());
CREATE POLICY admin_update ON "referral_codes" FOR UPDATE USING (app_platform_admin()) WITH CHECK (app_platform_admin());

-- A referrer sees the people they brought in; nobody else does.
ALTER TABLE "referral_attributions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "referral_attributions" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_referrer ON "referral_attributions" FOR SELECT USING (referrer_id = app_current_user() OR app_platform_admin());
CREATE POLICY admin_write ON "referral_attributions" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
