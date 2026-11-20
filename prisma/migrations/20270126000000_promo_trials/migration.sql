-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "discount_kobo" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "list_amount_kobo" BIGINT,
ADD COLUMN     "promo_code_id" TEXT;

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "percent_off" INTEGER,
    "amount_off_minor" BIGINT,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "plan_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "max_redemptions" INTEGER,
    "per_owner_once" BOOLEAN NOT NULL DEFAULT true,
    "new_customers_only" BOOLEAN NOT NULL DEFAULT false,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_redemptions" (
    "id" TEXT NOT NULL,
    "promo_code_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "owner_key" TEXT NOT NULL,
    "discount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trial_uses" (
    "id" TEXT NOT NULL,
    "owner_key" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "started_by_id" TEXT NOT NULL,

    CONSTRAINT "trial_uses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "promo_redemptions_invoice_id_key" ON "promo_redemptions"("invoice_id");

-- CreateIndex
CREATE INDEX "promo_redemptions_promo_code_id_idx" ON "promo_redemptions"("promo_code_id");

-- CreateIndex
CREATE INDEX "promo_redemptions_owner_key_idx" ON "promo_redemptions"("owner_key");

-- CreateIndex
CREATE UNIQUE INDEX "trial_uses_owner_key_plan_id_key" ON "trial_uses"("owner_key", "plan_id");

-- AddForeignKey
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "invoices" ADD CONSTRAINT "invoices_discount_nonneg" CHECK (discount_kobo >= 0);

-- Promo codes: exactly one kind of discount, a sane percentage or a positive amount, upper-case letters and digits only.
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_one_kind" CHECK ((percent_off IS NULL) <> (amount_off_minor IS NULL));
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_percent" CHECK (percent_off IS NULL OR percent_off BETWEEN 1 AND 100);
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_amount" CHECK (amount_off_minor IS NULL OR amount_off_minor > 0);
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_code_shape" CHECK (code ~ '^[A-Z0-9]{4,30}$');
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_max" CHECK (max_redemptions IS NULL OR max_redemptions > 0);
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_dates" CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at >= starts_at);
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_discount" CHECK (discount_minor > 0);
ALTER TABLE "trial_uses" ADD CONSTRAINT "trial_uses_dates" CHECK (ends_at > started_at);

-- Codes, redemptions and trial records are only read and written by the platform's billing engine (platform context).
ALTER TABLE "promo_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "promo_codes" FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_all ON "promo_codes" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
ALTER TABLE "promo_redemptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "promo_redemptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_all ON "promo_redemptions" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
ALTER TABLE "trial_uses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trial_uses" FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_all ON "trial_uses" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

-- An invoice is for a positive amount, except one a promo code covered completely (nothing to pay, discount equal to the list price).
ALTER TABLE "invoices" DROP CONSTRAINT invoice_amount;
ALTER TABLE "invoices" ADD CONSTRAINT invoice_amount CHECK ((amount_kobo > 0 OR (amount_kobo = 0 AND promo_code_id IS NOT NULL AND discount_kobo > 0 AND list_amount_kobo = discount_kobo)) AND period_months BETWEEN 0 AND 36 AND char_length(description) <= 300 AND char_length(void_reason) <= 300);
ALTER TABLE "invoices" ADD CONSTRAINT invoice_discount_sum CHECK (list_amount_kobo IS NULL OR list_amount_kobo = amount_kobo + discount_kobo);
