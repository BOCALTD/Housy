-- Paying a monthly plan yearly: the subscription remembers the cycle so renewals stay yearly.
ALTER TABLE "subscriptions" ADD COLUMN "cycle_months" INTEGER;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_cycle_months" CHECK (cycle_months IS NULL OR cycle_months BETWEEN 1 AND 36);
