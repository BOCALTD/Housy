-- Which industry template a company started from (letting agency, brokerage, developer, facility manager, institution), so the
-- dashboard can show the right first steps. Empty until the administrator applies one.
ALTER TABLE "companies" ADD COLUMN "industry_template" TEXT NOT NULL DEFAULT '';
ALTER TABLE "companies" ADD CONSTRAINT companies_industry_template CHECK (industry_template IN ('', 'LETTING', 'BROKERAGE', 'DEVELOPER', 'FACILITY', 'INSTITUTION'));
