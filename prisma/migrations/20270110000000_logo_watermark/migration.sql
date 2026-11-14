-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "logo_bytes" BYTEA,
ADD COLUMN     "logo_mime" TEXT,
ADD COLUMN     "logo_watermark" BOOLEAN NOT NULL DEFAULT false;



-- ---------- Not generated ----------
-- A logo is a picture of at most 1 MB.
ALTER TABLE "companies" ADD CONSTRAINT company_logo CHECK ((logo_bytes IS NULL) = (logo_mime IS NULL) AND (logo_mime IS NULL OR logo_mime IN ('image/png', 'image/jpeg', 'image/webp')) AND (logo_bytes IS NULL OR octet_length(logo_bytes) <= 1048576));

-- The logo watermark is a paid feature: on the Pro and Elite plans for companies and agents. Administrators can change this in Plans.
SELECT set_config('app.platform_admin', 'on', false);
INSERT INTO plan_entitlements (id, plan_id, key, "limit")
  SELECT gen_random_uuid()::text, p.id, 'LOGO_WATERMARK', NULL::int FROM subscription_plans p
  WHERE p.code IN ('company-silver', 'company-gold', 'company-professional', 'agent-professional', 'agent-elite')
    AND NOT EXISTS (SELECT 1 FROM plan_entitlements x WHERE x.plan_id = p.id AND x.key = 'LOGO_WATERMARK');
SELECT set_config('app.platform_admin', '', false);
