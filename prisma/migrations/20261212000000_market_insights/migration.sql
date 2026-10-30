-- Market insights: when a published listing was taken off the market, so time on the market can be measured.
ALTER TABLE "listings" ADD COLUMN "off_market_at" TIMESTAMP(3);
