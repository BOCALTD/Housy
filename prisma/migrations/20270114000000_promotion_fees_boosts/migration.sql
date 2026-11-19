-- Promotion fees are paid through invoices (online or by recorded bank transfer); companies can buy boosts for single properties.
-- CreateEnum
CREATE TYPE "BoostStatus" AS ENUM ('AWAITING_PAYMENT', 'ACTIVE', 'CANCELLED');

-- AlterEnum


ALTER TYPE "InvoicePurpose" ADD VALUE 'PROMOTION';
ALTER TYPE "InvoicePurpose" ADD VALUE 'BOOST';

-- AlterTable
ALTER TABLE "promo_payments" ADD COLUMN     "invoice_id" TEXT;

-- CreateTable
CREATE TABLE "listing_boosts" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "price_kobo" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" "BoostStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "invoice_id" TEXT,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "cancel_reason" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_boosts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "listing_boosts_ref_key" ON "listing_boosts"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "listing_boosts_invoice_id_key" ON "listing_boosts"("invoice_id");

-- CreateIndex
CREATE INDEX "listing_boosts_status_ends_at_idx" ON "listing_boosts"("status", "ends_at");

-- CreateIndex
CREATE INDEX "listing_boosts_company_id_created_at_idx" ON "listing_boosts"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "listing_boosts_listing_id_status_idx" ON "listing_boosts"("listing_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "promo_payments_invoice_id_key" ON "promo_payments"("invoice_id");

-- AddForeignKey
ALTER TABLE "listing_boosts" ADD CONSTRAINT "listing_boosts_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "listing_boosts" ADD CONSTRAINT "listing_boosts_values" CHECK (days BETWEEN 1 AND 365 AND price_kobo > 0 AND (status <> 'ACTIVE' OR (starts_at IS NOT NULL AND ends_at > starts_at)));

-- Boosts: the company sees and asks for its own; anyone may see that a property is boosted (it is shown publicly, labelled);
-- starting a boost (payment) and cancelling it happen as the platform.
ALTER TABLE "listing_boosts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "listing_boosts" FORCE ROW LEVEL SECURITY;
CREATE POLICY read_visible ON "listing_boosts" FOR SELECT USING (status = 'ACTIVE' OR company_id = app_current_company() OR app_platform_admin());
CREATE POLICY request_own ON "listing_boosts" FOR INSERT WITH CHECK ((company_id = app_current_company() AND status = 'AWAITING_PAYMENT') OR app_platform_admin());
CREATE POLICY platform_admin ON "listing_boosts" FOR UPDATE USING (app_platform_admin()) WITH CHECK (app_platform_admin());
