-- Plans are Basic (free), Pro and Elite for people looking for a home, agents and companies (perks levels BASIC, SILVER, GOLD).
-- Only plans still carrying their starting names are renamed, so nothing an administrator changed is overwritten. No plan with
-- subscribers is removed or switched off. New paid plans have no price until the administrator sets one.
SELECT set_config('app.platform_admin', 'on', false);

UPDATE subscription_plans SET name = 'Basic', tier = 'BASIC', updated_at = now() WHERE code = 'free-seeker' AND name = 'Free';
UPDATE subscription_plans SET name = 'Pro', tier = 'SILVER', updated_at = now() WHERE code = 'premium-seeker' AND name = 'Premium Seeker';
UPDATE subscription_plans SET name = 'Pro', tier = 'SILVER', updated_at = now() WHERE code = 'agent-professional' AND name = 'Agent Professional';
UPDATE subscription_plans SET name = 'Basic', tier = 'BASIC', updated_at = now() WHERE code = 'free-company' AND name = 'Free';
UPDATE subscription_plans SET name = 'Pro', updated_at = now() WHERE code = 'company-silver' AND name = 'Silver';
UPDATE subscription_plans SET name = 'Elite', updated_at = now() WHERE code = 'company-gold' AND name = 'Gold';
-- The older company plans overlap with Pro and Elite: switched off if untouched and nobody is on them.
UPDATE subscription_plans p SET active = false, updated_at = now()
  WHERE p.code IN ('company-professional', 'enterprise') AND p.name IN ('Company Professional', 'Enterprise')
    AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.plan_id = p.id);

INSERT INTO subscription_plans (id, code, name, audience, price_kobo, billing_period, grace_days, read_only_days, sort_order, tier, updated_at) VALUES
  (gen_random_uuid()::text, 'seeker-elite', 'Elite', 'SEEKER', NULL, 'MONTHLY', 7, 30, 22, 'GOLD', now()),
  (gen_random_uuid()::text, 'agent-basic', 'Basic', 'AGENT', 0, 'NONE', 7, 30, 28, 'BASIC', now()),
  (gen_random_uuid()::text, 'agent-elite', 'Elite', 'AGENT', NULL, 'MONTHLY', 7, 30, 32, 'GOLD', now())
ON CONFLICT (code) DO NOTHING;
INSERT INTO plan_entitlements (id, plan_id, key, "limit")
  SELECT gen_random_uuid()::text, p.id, e.key, e.lim FROM subscription_plans p JOIN (VALUES
    ('seeker-elite', 'COLLAB_SEEKER_AGENT', NULL::int), ('seeker-elite', 'CONTACT_DETAILS', NULL),
    ('agent-elite', 'CONTACT_DETAILS', NULL), ('agent-elite', 'BULK_MESSAGING', NULL)
  ) AS e(code, key, lim) ON e.code = p.code
  WHERE NOT EXISTS (SELECT 1 FROM plan_entitlements x WHERE x.plan_id = p.id AND x.key = e.key);

SELECT set_config('app.platform_admin', '', false);
