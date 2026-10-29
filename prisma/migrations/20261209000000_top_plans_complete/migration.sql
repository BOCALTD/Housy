-- Every plan is now shown side by side with the features it lacks struck through, and the top plan of each audience includes
-- everything. Bring the starting plans in line: Enterprise gets advertising and the Gold perks, Agent Professional gets
-- advertising. Only adds what is missing; anything the platform administrator has changed is left alone.
SELECT set_config('app.platform_admin', 'on', false);

INSERT INTO plan_entitlements (id, plan_id, key, "limit")
SELECT gen_random_uuid()::text, p.id, e.key, NULL
FROM subscription_plans p JOIN (VALUES ('enterprise', 'ADVERTISING'), ('agent-professional', 'ADVERTISING')) AS e(code, key) ON e.code = p.code
WHERE NOT EXISTS (SELECT 1 FROM plan_entitlements x WHERE x.plan_id = p.id AND x.key = e.key);

UPDATE subscription_plans SET tier = 'GOLD', updated_at = now() WHERE code = 'enterprise' AND tier = 'BASIC';

SELECT set_config('app.platform_admin', '', false);
