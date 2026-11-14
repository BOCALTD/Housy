-- AlterEnum
ALTER TYPE "PaymentProviderKind" ADD VALUE 'STRIPE';

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'NG',
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'NGN';

-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'NGN';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'NGN';

-- AlterTable
ALTER TABLE "finance_entries" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'NGN';

-- AlterTable
ALTER TABLE "verification_payout_accounts" ADD COLUMN     "bank_details" JSONB,
ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'NG';

-- AlterTable
ALTER TABLE "company_payment_settings" ADD COLUMN     "bank_details" JSONB,
ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'NG',
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'NGN',
ADD COLUMN     "stripe_account" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "stripe_ready" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "client_payments" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'NGN',
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "plan_prices" (
    "plan_id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_prices_pkey" PRIMARY KEY ("plan_id","currency")
);

-- AddForeignKey
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ---------- Not generated ----------
-- Plan prices in other currencies: read like the plans, written by the platform administrator.
ALTER TABLE "plan_prices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plan_prices" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_signed_in ON "plan_prices" FOR SELECT USING (app_current_user() IS NOT NULL OR app_platform_admin());
CREATE POLICY admin_write ON "plan_prices" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
ALTER TABLE "plan_prices" ADD CONSTRAINT plan_price_values CHECK (amount_minor > 0 AND currency IN ('GHS', 'KES', 'ZAR', 'USD', 'GBP', 'CAD', 'EUR', 'AUD', 'AED'));

-- Only the countries and currencies Housy supports (see src/lib/regions.ts).
ALTER TABLE "companies" ADD CONSTRAINT company_region CHECK (country IN ('NG', 'GH', 'KE', 'ZA', 'US', 'GB', 'CA', 'IE', 'DE', 'FR', 'NL', 'ES', 'IT', 'AU', 'AE') AND currency IN ('NGN', 'GHS', 'KES', 'ZAR', 'USD', 'GBP', 'CAD', 'EUR', 'AUD', 'AED'));
ALTER TABLE "listings" ADD CONSTRAINT listing_currency CHECK (currency IN ('NGN', 'GHS', 'KES', 'ZAR', 'USD', 'GBP', 'CAD', 'EUR', 'AUD', 'AED'));
ALTER TABLE "invoices" ADD CONSTRAINT invoice_currency CHECK (currency IN ('NGN', 'GHS', 'KES', 'ZAR', 'USD', 'GBP', 'CAD', 'EUR', 'AUD', 'AED'));
ALTER TABLE "finance_entries" ADD CONSTRAINT entry_currency CHECK (currency IN ('NGN', 'GHS', 'KES', 'ZAR', 'USD', 'GBP', 'CAD', 'EUR', 'AUD', 'AED'));
ALTER TABLE "client_payments" ADD CONSTRAINT client_payment_region CHECK (currency IN ('NGN', 'GHS', 'KES', 'ZAR', 'USD', 'GBP', 'CAD', 'EUR', 'AUD', 'AED') AND provider IN ('', 'PAYSTACK', 'STRIPE'));
ALTER TABLE "company_payment_settings" ADD CONSTRAINT payment_settings_region CHECK (currency IN ('NGN', 'GHS', 'KES', 'ZAR', 'USD', 'GBP', 'CAD', 'EUR', 'AUD', 'AED'));

-- Existing Nigerian bank accounts keep working: their details in the per-country form.
UPDATE "company_payment_settings" SET bank_details = jsonb_build_object('bankName', bank_name, 'accountName', account_name, 'accountNumber', account_number) WHERE account_number <> '';
UPDATE "verification_payout_accounts" SET bank_details = jsonb_build_object('bankName', bank_name, 'accountName', account_name, 'accountNumber', account_number);
