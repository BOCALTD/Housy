-- AlterTable
ALTER TABLE "users" ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'NG',
ADD COLUMN     "time_zone" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "time_zone" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "verification_payouts" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'NGN',
ADD COLUMN     "sent_minor" BIGINT;



-- ---------- Not generated ----------
-- Only the countries and currencies Housy supports (src/lib/regions.ts). Time zones are checked by the app against the IANA list.
ALTER TABLE "users" ADD CONSTRAINT user_country CHECK (country IN ('NG', 'GH', 'KE', 'ZA', 'US', 'GB', 'CA', 'IE', 'DE', 'FR', 'NL', 'ES', 'IT', 'AU', 'AE'));
ALTER TABLE "verification_payouts" ADD CONSTRAINT payout_currency CHECK (currency IN ('NGN', 'GHS', 'KES', 'ZAR', 'USD', 'GBP', 'CAD', 'EUR', 'AUD', 'AED') AND (sent_minor IS NULL OR sent_minor > 0));

-- The payout guard also keeps the account's currency fixed, and a payout abroad is recorded as paid only with the amount sent.
CREATE OR REPLACE FUNCTION verification_payout_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payouts are never deleted';
  END IF;
  IF OLD.status <> 'PREPARED' THEN
    RAISE EXCEPTION 'A % payout never changes', lower(OLD.status::text);
  END IF;
  IF NEW.ref <> OLD.ref OR NEW.provider_id <> OLD.provider_id OR NEW.total_kobo <> OLD.total_kobo OR NEW.bank_name <> OLD.bank_name
     OR NEW.account_name <> OLD.account_name OR NEW.account_number <> OLD.account_number OR NEW.currency <> OLD.currency THEN
    RAISE EXCEPTION 'A payout''s amount and bank account never change';
  END IF;
  IF NEW.status = 'PAID' AND (length(trim(NEW.transfer_reference)) < 3 OR NEW.paid_by_id IS NULL OR NEW.paid_at IS NULL) THEN
    RAISE EXCEPTION 'A paid payout needs the transfer reference, who recorded it and when';
  END IF;
  IF NEW.status = 'PAID' AND NEW.currency <> 'NGN' AND NEW.sent_minor IS NULL THEN
    RAISE EXCEPTION 'A payout to an account abroad needs the amount sent';
  END IF;
  RETURN NEW;
END $$;
