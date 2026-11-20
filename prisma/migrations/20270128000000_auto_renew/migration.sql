-- Automatic renewal with a saved card.
ALTER TABLE "invoices" ADD COLUMN "auto_renew_consent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "payments" ADD COLUMN "automatic" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "subscriptions" ADD COLUMN "auto_renew" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "saved_cards" (
    "id" TEXT NOT NULL,
    "owner_key" TEXT NOT NULL,
    "provider" "PaymentProviderKind" NOT NULL,
    "token_sealed" TEXT NOT NULL,
    "customer_sealed" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "last4" TEXT NOT NULL,
    "brand" TEXT NOT NULL DEFAULT '',
    "exp_month" INTEGER NOT NULL,
    "exp_year" INTEGER NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_cards_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "saved_cards_owner_key_key" ON "saved_cards"("owner_key");

-- Only cards the providers can charge again: online providers, a real expiry, four digits shown, an owner key of the usual shape.
ALTER TABLE "saved_cards" ADD CONSTRAINT "saved_cards_provider" CHECK (provider IN ('PAYSTACK', 'STRIPE'));
ALTER TABLE "saved_cards" ADD CONSTRAINT "saved_cards_shape" CHECK (last4 ~ '^[0-9]{4}$' AND exp_month BETWEEN 1 AND 12 AND exp_year BETWEEN 2000 AND 2100 AND owner_key ~ '^(USER|COMPANY):' AND failures >= 0);

-- Read and written only by the billing engine (platform context); people see their card through the billing pages.
ALTER TABLE "saved_cards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saved_cards" FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_all ON "saved_cards" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
