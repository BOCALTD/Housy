-- CreateEnum
CREATE TYPE "PlanAudience" AS ENUM ('SEEKER', 'AGENT', 'COMPANY');

-- CreateEnum
CREATE TYPE "BillingPeriod" AS ENUM ('NONE', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "SubscriptionOwner" AS ENUM ('USER', 'COMPANY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubscriptionEventKind" AS ENUM ('ASSIGNED', 'RENEWED', 'PLAN_CHANGED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FollowTarget" AS ENUM ('AGENT', 'COMPANY', 'DEVELOPER');

-- CreateEnum
CREATE TYPE "ProfileKind" AS ENUM ('COMPANY', 'DEVELOPER');

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "audience" "PlanAudience" NOT NULL,
    "price_kobo" BIGINT,
    "billing_period" "BillingPeriod" NOT NULL DEFAULT 'NONE',
    "trial_days" INTEGER NOT NULL DEFAULT 0,
    "grace_days" INTEGER NOT NULL DEFAULT 7,
    "read_only_days" INTEGER NOT NULL DEFAULT 30,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_entitlements" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "limit" INTEGER,

    CONSTRAINT "plan_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "owner_kind" "SubscriptionOwner" NOT NULL,
    "owner_user_id" TEXT,
    "owner_company_id" TEXT,
    "plan_id" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "period_end" TIMESTAMP(3) NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_events" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "kind" "SubscriptionEventKind" NOT NULL,
    "from_plan_id" TEXT,
    "to_plan_id" TEXT NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_id" TEXT,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "follows" (
    "id" TEXT NOT NULL,
    "follower_id" TEXT NOT NULL,
    "target_kind" "FollowTarget" NOT NULL,
    "target_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_profiles" (
    "id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "company_name" TEXT NOT NULL DEFAULT '',
    "headline" TEXT NOT NULL DEFAULT '',
    "bio" TEXT NOT NULL DEFAULT '',
    "listed" BOOLEAN NOT NULL DEFAULT false,
    "accepts_messages" BOOLEAN NOT NULL DEFAULT true,
    "follower_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_profiles" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "kind" "ProfileKind" NOT NULL DEFAULT 'COMPANY',
    "display_name" TEXT NOT NULL,
    "tagline" TEXT NOT NULL DEFAULT '',
    "about" TEXT NOT NULL DEFAULT '',
    "listed" BOOLEAN NOT NULL DEFAULT false,
    "follower_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "link" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_code_key" ON "subscription_plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "plan_entitlements_plan_id_key_key" ON "plan_entitlements"("plan_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_owner_user_id_key" ON "subscriptions"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_owner_company_id_key" ON "subscriptions"("owner_company_id");

-- CreateIndex
CREATE INDEX "subscription_events_subscription_id_created_at_idx" ON "subscription_events"("subscription_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "follows_follower_id_target_kind_target_id_key" ON "follows"("follower_id", "target_kind", "target_id");

-- CreateIndex
CREATE INDEX "follows_target_kind_target_id_idx" ON "follows"("target_kind", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_profiles_membership_id_key" ON "agent_profiles"("membership_id");

-- CreateIndex
CREATE INDEX "agent_profiles_user_id_idx" ON "agent_profiles"("user_id");

-- CreateIndex
CREATE INDEX "agent_profiles_listed_idx" ON "agent_profiles"("listed");

-- CreateIndex
CREATE UNIQUE INDEX "company_profiles_company_id_key" ON "company_profiles"("company_id");

-- CreateIndex
CREATE INDEX "company_profiles_listed_kind_idx" ON "company_profiles"("listed", "kind");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- AddForeignKey
ALTER TABLE "plan_entitlements" ADD CONSTRAINT "plan_entitlements_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Rules the database holds whatever the application does.
ALTER TABLE "subscription_plans" ADD CONSTRAINT subscription_plans_code_format CHECK (code ~ '^[a-z0-9-]{3,40}$');
ALTER TABLE "subscription_plans" ADD CONSTRAINT subscription_plans_name_present CHECK (length(btrim(name)) >= 2);
ALTER TABLE "subscription_plans" ADD CONSTRAINT subscription_plans_numbers CHECK (trial_days >= 0 AND grace_days >= 0 AND read_only_days >= 0 AND (price_kobo IS NULL OR price_kobo >= 0));
ALTER TABLE "plan_entitlements" ADD CONSTRAINT plan_entitlements_limit CHECK ("limit" IS NULL OR "limit" >= 0);
ALTER TABLE "subscriptions" ADD CONSTRAINT subscriptions_one_owner CHECK (
  (owner_kind = 'USER' AND owner_user_id IS NOT NULL AND owner_company_id IS NULL) OR
  (owner_kind = 'COMPANY' AND owner_company_id IS NOT NULL AND owner_user_id IS NULL)
);
ALTER TABLE "subscriptions" ADD CONSTRAINT subscriptions_period CHECK (period_end > started_at);
ALTER TABLE "subscriptions" ADD CONSTRAINT subscriptions_cancelled_dated CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL));
ALTER TABLE "follows" ADD CONSTRAINT follows_not_self CHECK (target_kind <> 'AGENT' OR follower_id <> target_id);
ALTER TABLE "agent_profiles" ADD CONSTRAINT agent_profiles_name_present CHECK (length(btrim(display_name)) >= 2);
ALTER TABLE "company_profiles" ADD CONSTRAINT company_profiles_name_present CHECK (length(btrim(display_name)) >= 2);
ALTER TABLE "notifications" ADD CONSTRAINT notifications_title_present CHECK (length(btrim(title)) >= 1);

-- Starting plans. Their names, limits and entitlements are the platform administrator's to change. Prices are left unset on purpose.
INSERT INTO subscription_plans (id, code, name, audience, price_kobo, billing_period, grace_days, read_only_days, sort_order, updated_at) VALUES
  (gen_random_uuid()::text, 'free-seeker', 'Free', 'SEEKER', 0, 'NONE', 7, 30, 10, now()),
  (gen_random_uuid()::text, 'premium-seeker', 'Premium Seeker', 'SEEKER', NULL, 'MONTHLY', 7, 30, 20, now()),
  (gen_random_uuid()::text, 'agent-professional', 'Agent Professional', 'AGENT', NULL, 'MONTHLY', 7, 30, 30, now()),
  (gen_random_uuid()::text, 'free-company', 'Free', 'COMPANY', 0, 'NONE', 7, 30, 40, now()),
  (gen_random_uuid()::text, 'company-professional', 'Company Professional', 'COMPANY', NULL, 'MONTHLY', 7, 30, 50, now()),
  (gen_random_uuid()::text, 'enterprise', 'Enterprise', 'COMPANY', NULL, 'YEARLY', 14, 60, 60, now());
INSERT INTO plan_entitlements (id, plan_id, key, "limit")
  SELECT gen_random_uuid()::text, p.id, e.key, e.lim FROM subscription_plans p JOIN (VALUES
    ('premium-seeker', 'COLLAB_SEEKER_AGENT', 3), ('premium-seeker', 'CONTACT_DETAILS', NULL),
    ('agent-professional', 'CONTACT_DETAILS', NULL),
    ('company-professional', 'COLLAB_COMPANY', 10), ('company-professional', 'CONTACT_DETAILS', NULL),
    ('enterprise', 'COLLAB_COMPANY', NULL), ('enterprise', 'CONTACT_DETAILS', NULL), ('enterprise', 'BULK_MESSAGING', NULL)
  ) AS e(code, key, lim) ON e.code = p.code;

-- Plans and platform settings: any signed-in person may read them; only the platform administrator changes them.
ALTER TABLE "subscription_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscription_plans" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_signed_in ON "subscription_plans" FOR SELECT USING (app_current_user() IS NOT NULL OR app_platform_admin());
CREATE POLICY admin_write ON "subscription_plans" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
ALTER TABLE "plan_entitlements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plan_entitlements" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_signed_in ON "plan_entitlements" FOR SELECT USING (app_current_user() IS NOT NULL OR app_platform_admin());
CREATE POLICY admin_write ON "plan_entitlements" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
ALTER TABLE "platform_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_all ON "platform_settings" FOR SELECT USING (true);
CREATE POLICY admin_write ON "platform_settings" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

-- Subscriptions: the owner and the platform administrator can read; only the administrator writes (payment is recorded by hand until the payments module).
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_read ON "subscriptions" FOR SELECT USING (
  owner_user_id = app_current_user() OR owner_company_id = app_current_company() OR app_platform_admin()
);
CREATE POLICY admin_write ON "subscriptions" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
ALTER TABLE "subscription_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscription_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_read ON "subscription_events" FOR SELECT USING (EXISTS (SELECT 1 FROM subscriptions s WHERE s.id = subscription_id));
CREATE POLICY admin_write ON "subscription_events" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

-- Following belongs to the follower alone.
ALTER TABLE "follows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "follows" FORCE ROW LEVEL SECURITY;
CREATE POLICY own_follows ON "follows" FOR ALL USING (follower_id = app_current_user()) WITH CHECK (follower_id = app_current_user());

-- Public profiles: anyone can read a listed profile; an agent or company changes only its own. These tables are not forced,
-- so the follower-count trigger (which runs as the table owner) can update the counts; the runtime role is still bound.
ALTER TABLE "agent_profiles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_read ON "agent_profiles" FOR SELECT USING (listed);
CREATE POLICY own_write ON "agent_profiles" FOR ALL
  USING (user_id = app_current_user() AND company_id = app_current_company())
  WITH CHECK (user_id = app_current_user() AND company_id = app_current_company());
CREATE POLICY admin_read ON "agent_profiles" FOR SELECT USING (app_platform_admin());
ALTER TABLE "company_profiles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_read ON "company_profiles" FOR SELECT USING (listed);
CREATE POLICY own_write ON "company_profiles" FOR ALL
  USING (company_id = app_current_company()) WITH CHECK (company_id = app_current_company());
CREATE POLICY admin_read ON "company_profiles" FOR SELECT USING (app_platform_admin());

-- The follower count follows the follows table without letting anyone read other people's follows.
CREATE OR REPLACE FUNCTION follows_count_sync() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k "FollowTarget"; t text;
BEGIN
  k := coalesce(NEW.target_kind, OLD.target_kind);
  t := coalesce(NEW.target_id, OLD.target_id);
  IF k = 'AGENT' THEN
    UPDATE agent_profiles SET follower_count = (SELECT count(*) FROM follows f WHERE f.target_kind = 'AGENT' AND f.target_id = t) WHERE user_id = t;
  ELSE
    UPDATE company_profiles SET follower_count = (SELECT count(*) FROM follows f WHERE f.target_kind IN ('COMPANY', 'DEVELOPER') AND f.target_id = t) WHERE company_id = t;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER follows_count_sync AFTER INSERT OR DELETE ON "follows" FOR EACH ROW EXECUTE FUNCTION follows_count_sync();

-- Notices: read and ticked off by their owner; anyone signed in may leave one for another person (for example an invitation).
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY own_read ON "notifications" FOR SELECT USING (user_id = app_current_user());
CREATE POLICY own_update ON "notifications" FOR UPDATE USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
CREATE POLICY own_delete ON "notifications" FOR DELETE USING (user_id = app_current_user());
CREATE POLICY signed_in_insert ON "notifications" FOR INSERT WITH CHECK (app_current_user() IS NOT NULL);

