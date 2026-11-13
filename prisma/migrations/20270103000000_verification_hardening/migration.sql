-- CreateIndex
CREATE INDEX "verification_assignments_status_respond_by_idx" ON "verification_assignments"("status", "respond_by");

-- CreateIndex
CREATE INDEX "verification_report_versions_case_id_version_idx" ON "verification_report_versions"("case_id", "version");


-- ---------- Verification network, stage 10: the case guard also checks who makes each move (not generated) ----------
-- Housy (an administrator or the system) may make any move the rules give Housy; the customer only theirs (cancel early,
-- answer a question, confirm or dispute the report); a provider's staff only the moves their role allows, on cases of their
-- organisation. Customers and providers may change only the columns their moves need. The moves below are generated from
-- src/lib/verification-case-rules.ts and a unit test keeps them equal.
CREATE OR REPLACE FUNCTION verification_case_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mover text;
  role text;
BEGIN
  IF NEW.requester_id <> OLD.requester_id OR NEW.ref <> OLD.ref THEN
    RAISE EXCEPTION 'A verification case keeps its requester and reference';
  END IF;
  IF app_platform_admin() THEN
    mover := 'platform';
  ELSIF app_current_user() IS NOT NULL AND app_current_user() = OLD.requester_id THEN
    mover := 'customer';
  ELSIF OLD.provider_id IS NOT NULL AND app_provider_role(OLD.provider_id) IS NOT NULL THEN
    mover := 'provider';
    role := app_provider_role(OLD.provider_id);
  ELSE
    RAISE EXCEPTION 'Not allowed to change this verification case';
  END IF;

  IF mover = 'customer' AND (to_jsonb(NEW) - ARRAY['status', 'closing_note', 'completed_at', 'updated_at']) <> (to_jsonb(OLD) - ARRAY['status', 'closing_note', 'completed_at', 'updated_at']) THEN
    RAISE EXCEPTION 'A customer can only move their case on, not change its details';
  END IF;
  IF mover = 'provider' AND (to_jsonb(NEW) - ARRAY['status', 'accept_by', 'officer_id', 'reviewer_id', 'info_request', 'updated_at']) <> (to_jsonb(OLD) - ARRAY['status', 'accept_by', 'officer_id', 'reviewer_id', 'info_request', 'updated_at']) THEN
    RAISE EXCEPTION 'A provider can only work the case, not change its details or who holds it';
  END IF;
  IF NEW.status = 'READY_FOR_ASSIGNMENT' AND NEW.provider_id IS NOT NULL THEN
    RAISE EXCEPTION 'A case waiting for a provider has no provider';
  END IF;

  IF NEW.status <> OLD.status AND NOT EXISTS (
    SELECT 1 FROM (VALUES
    ('platform','REQUESTED','PENDING_PAYMENT',''),
    ('platform','REQUESTED','READY_FOR_ASSIGNMENT',''),
    ('platform','REQUESTED','REJECTED',''),
    ('platform','REQUESTED','CANCELLED',''),
    ('customer','REQUESTED','CANCELLED',''),
    ('platform','PENDING_PAYMENT','READY_FOR_ASSIGNMENT',''),
    ('platform','PENDING_PAYMENT','CANCELLED',''),
    ('customer','PENDING_PAYMENT','CANCELLED',''),
    ('platform','READY_FOR_ASSIGNMENT','ASSIGNED',''),
    ('platform','READY_FOR_ASSIGNMENT','REJECTED',''),
    ('platform','READY_FOR_ASSIGNMENT','CANCELLED',''),
    ('customer','READY_FOR_ASSIGNMENT','CANCELLED',''),
    ('platform','ASSIGNED','READY_FOR_ASSIGNMENT',''),
    ('provider','ASSIGNED','READY_FOR_ASSIGNMENT','OWNER ADMIN MANAGER'),
    ('provider','ASSIGNED','ACCEPTED','OWNER ADMIN MANAGER'),
    ('platform','ASSIGNED','CANCELLED',''),
    ('provider','ACCEPTED','DOCUMENT_REVIEW','OWNER ADMIN MANAGER INVESTIGATOR'),
    ('platform','ACCEPTED','CANCELLED',''),
    ('provider','DOCUMENT_REVIEW','INFORMATION_REQUIRED','OWNER ADMIN INVESTIGATOR'),
    ('provider','DOCUMENT_REVIEW','FIELD_INSPECTION','OWNER ADMIN INVESTIGATOR'),
    ('provider','DOCUMENT_REVIEW','INVESTIGATION_IN_PROGRESS','OWNER ADMIN INVESTIGATOR'),
    ('platform','DOCUMENT_REVIEW','CANCELLED',''),
    ('customer','INFORMATION_REQUIRED','DOCUMENT_REVIEW',''),
    ('provider','INFORMATION_REQUIRED','DOCUMENT_REVIEW','OWNER ADMIN INVESTIGATOR'),
    ('platform','INFORMATION_REQUIRED','CANCELLED',''),
    ('customer','INFORMATION_REQUIRED','CANCELLED',''),
    ('provider','FIELD_INSPECTION','INVESTIGATION_IN_PROGRESS','OWNER ADMIN INVESTIGATOR'),
    ('platform','FIELD_INSPECTION','CANCELLED',''),
    ('provider','INVESTIGATION_IN_PROGRESS','INFORMATION_REQUIRED','OWNER ADMIN INVESTIGATOR'),
    ('provider','INVESTIGATION_IN_PROGRESS','FIELD_INSPECTION','OWNER ADMIN INVESTIGATOR'),
    ('provider','INVESTIGATION_IN_PROGRESS','REPORT_DRAFT','OWNER ADMIN INVESTIGATOR'),
    ('platform','INVESTIGATION_IN_PROGRESS','CANCELLED',''),
    ('provider','REPORT_DRAFT','INTERNAL_REVIEW','OWNER ADMIN INVESTIGATOR'),
    ('platform','REPORT_DRAFT','CANCELLED',''),
    ('provider','INTERNAL_REVIEW','CORRECTION_REQUIRED','OWNER REVIEWER'),
    ('provider','INTERNAL_REVIEW','SUBMITTED_TO_HOUSY','OWNER REVIEWER'),
    ('platform','INTERNAL_REVIEW','CANCELLED',''),
    ('provider','CORRECTION_REQUIRED','REPORT_DRAFT','OWNER ADMIN INVESTIGATOR'),
    ('platform','CORRECTION_REQUIRED','CANCELLED',''),
    ('platform','SUBMITTED_TO_HOUSY','PLATFORM_REVIEW',''),
    ('platform','PLATFORM_REVIEW','CORRECTION_REQUIRED',''),
    ('platform','PLATFORM_REVIEW','APPROVED_FOR_RELEASE',''),
    ('platform','PLATFORM_REVIEW','CANCELLED',''),
    ('platform','APPROVED_FOR_RELEASE','DELIVERED',''),
    ('platform','DELIVERED','COMPLETED',''),
    ('customer','DELIVERED','COMPLETED',''),
    ('customer','DELIVERED','DISPUTED',''),
    ('platform','DISPUTED','PLATFORM_REVIEW',''),
    ('platform','DISPUTED','COMPLETED','')
    ) AS m(by_whom, f, t, roles)
    WHERE m.by_whom = mover AND m.f = OLD.status::text AND m.t = NEW.status::text
      AND (mover <> 'provider' OR role = ANY (string_to_array(m.roles, ' ')))
  ) THEN
    RAISE EXCEPTION 'A verification case cannot be moved from % to % by the %', OLD.status, NEW.status, mover;
  END IF;
  RETURN NEW;
END $$;

-- ---------- Payout bank accounts move out of the public provider record into their own protected table ----------
CREATE TABLE "verification_payout_accounts" (
    "provider_id" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_payout_accounts_pkey" PRIMARY KEY ("provider_id")
);

-- Carry over any account already recorded (stage 7 kept it on the provider record).
INSERT INTO "verification_payout_accounts" ("provider_id", "bank_name", "account_name", "account_number", "updated_by_id", "updated_at")
SELECT "id", "payout_bank_name", "payout_account_name", "payout_account_number", 'carried-over', coalesce("payout_updated_at", now())
FROM "service_providers" WHERE "payout_account_number" <> '';

ALTER TABLE "service_providers" DROP COLUMN "payout_account_name",
DROP COLUMN "payout_account_number",
DROP COLUMN "payout_bank_name",
DROP COLUMN "payout_updated_at";

ALTER TABLE "verification_payout_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_payout_accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_finance_read ON "verification_payout_accounts" FOR SELECT USING (app_current_user() IS NOT NULL AND app_provider_role(provider_id) IN ('OWNER', 'FINANCE'));
CREATE POLICY platform_admin ON "verification_payout_accounts" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
