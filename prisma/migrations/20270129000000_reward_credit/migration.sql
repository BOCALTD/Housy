-- Rewards used toward a plan invoice.
ALTER TABLE "invoices" ADD COLUMN "credit_kobo" BIGINT NOT NULL DEFAULT 0;

-- The list price is what is left to pay plus the promo discount plus the rewards used; nothing to pay only when those cover it all.
ALTER TABLE "invoices" DROP CONSTRAINT invoice_discount_sum;
ALTER TABLE "invoices" ADD CONSTRAINT invoice_discount_sum CHECK (list_amount_kobo IS NULL OR list_amount_kobo = amount_kobo + discount_kobo + credit_kobo);
ALTER TABLE "invoices" DROP CONSTRAINT invoice_amount;
ALTER TABLE "invoices" ADD CONSTRAINT invoice_amount CHECK ((amount_kobo > 0 OR (amount_kobo = 0 AND (discount_kobo + credit_kobo) > 0 AND list_amount_kobo = discount_kobo + credit_kobo AND (promo_code_id IS NOT NULL OR credit_kobo > 0))) AND period_months BETWEEN 0 AND 36 AND char_length(description) <= 300 AND char_length(void_reason) <= 300);
ALTER TABLE "invoices" ADD CONSTRAINT invoice_credit_nonneg CHECK (credit_kobo >= 0);
