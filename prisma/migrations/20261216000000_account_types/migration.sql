-- Separate sign-up for personal accounts, agents and companies: a phone on the user, and what each company is.
ALTER TABLE "users" ADD COLUMN "phone" TEXT NOT NULL DEFAULT '';
ALTER TABLE "companies" ADD COLUMN "business_type" TEXT NOT NULL DEFAULT '';
ALTER TABLE "companies" ADD COLUMN "contact_email" TEXT NOT NULL DEFAULT '';
ALTER TABLE "companies" ADD COLUMN "contact_phone" TEXT NOT NULL DEFAULT '';
ALTER TABLE "companies" ADD COLUMN "cac_number" TEXT NOT NULL DEFAULT '';
ALTER TABLE "companies" ADD CONSTRAINT "companies_business_type_check"
  CHECK ("business_type" IN ('', 'AGENCY', 'PROPERTY_MANAGER', 'DEVELOPER', 'FACILITY', 'INSTITUTION', 'INDEPENDENT_AGENT'));
