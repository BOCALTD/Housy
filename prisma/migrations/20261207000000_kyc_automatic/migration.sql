-- Automatic identity and business checks. When the person agrees, a check is first compared with the official record through a
-- licensed provider; a confirmed match is verified automatically (reviewer "system"), and anything else goes to a person.
ALTER TABLE "kyc_items" ADD COLUMN "auto_consent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "kyc_items" ADD COLUMN "auto_outcome" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "kyc_items" ADD COLUMN "auto_provider" TEXT NOT NULL DEFAULT '';
ALTER TABLE "kyc_items" ADD COLUMN "auto_reference" TEXT NOT NULL DEFAULT '';
ALTER TABLE "kyc_items" ADD COLUMN "auto_note" TEXT NOT NULL DEFAULT '';
ALTER TABLE "kyc_items" ADD COLUMN "auto_at" TIMESTAMP(3);

ALTER TABLE "kyc_items" ADD CONSTRAINT kyc_items_auto CHECK (
  auto_outcome IN ('NONE', 'MATCH', 'NO_MATCH', 'NOT_FOUND', 'UNAVAILABLE', 'NOT_SUPPORTED', 'NO_CONSENT')
  AND char_length(auto_provider) <= 40 AND char_length(auto_reference) <= 120 AND char_length(auto_note) <= 500
  -- Nothing is checked with a provider unless the person asked for it.
  AND (auto_outcome IN ('NONE', 'NO_CONSENT', 'NOT_SUPPORTED') OR auto_consent)
);

-- The verification team's queue shows what the automatic check found.
CREATE INDEX "kyc_items_auto_outcome_idx" ON "kyc_items"("auto_outcome");
