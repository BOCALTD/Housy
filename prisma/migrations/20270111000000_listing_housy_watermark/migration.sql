-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "housy_watermark" BOOLEAN;


-- ---------- Not generated ----------
-- Properties already posted keep the setting in force now (on unless the administrator switched it off).
SELECT set_config('app.platform_admin', 'on', false);
UPDATE listings SET housy_watermark = COALESCE((SELECT value <> '0' FROM platform_settings WHERE key = 'watermark_housy'), true)
  WHERE published_at IS NOT NULL AND housy_watermark IS NULL;
SELECT set_config('app.platform_admin', '', false);
