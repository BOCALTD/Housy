-- Accounting export (master prompt §13.3): the company's own account codes for the journal it downloads.
ALTER TABLE "companies" ADD COLUMN "accounting_codes" JSONB NOT NULL DEFAULT '{}';
