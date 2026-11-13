-- The verification network, stages 1 to 3: provider applications and Housy's review, provider organisations with
-- their own staff and roles, the services and areas each offers, and row-level security keeping each provider's
-- records to itself.

-- CreateEnum
CREATE TYPE "VpRole" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'INVESTIGATOR', 'REVIEWER', 'FINANCE');

-- CreateEnum
CREATE TYPE "VpApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'ADDITIONAL_INFORMATION_REQUIRED', 'RESUBMITTED', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "service_providers" ADD COLUMN     "allowed_services" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "allowed_states" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "cac_number" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "contact_email" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "contact_phone" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'Nigeria',
ADD COLUMN     "legal_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "logo_bytes" BYTEA,
ADD COLUMN     "logo_mime" TEXT,
ADD COLUMN     "org_type" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "provider_code" TEXT,
ADD COLUMN     "suspended_at" TIMESTAMP(3),
ADD COLUMN     "suspended_reason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "vetted_at" TIMESTAMP(3),
ADD COLUMN     "vetted_by_id" TEXT;

-- AlterTable
ALTER TABLE "provider_members" ADD COLUMN     "role" "VpRole" NOT NULL DEFAULT 'INVESTIGATOR',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "title" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "verification_provider_applications" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "applicant_id" TEXT NOT NULL,
    "status" "VpApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "registered_name" TEXT NOT NULL DEFAULT '',
    "cac_number" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT '',
    "services" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "states" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "answers" JSONB NOT NULL DEFAULT '{}',
    "info_request" TEXT NOT NULL DEFAULT '',
    "decision_reason" TEXT NOT NULL DEFAULT '',
    "submitted_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),
    "decided_by_id" TEXT,
    "provider_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_provider_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_provider_application_events" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "from_status" TEXT NOT NULL DEFAULT '',
    "to_status" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_provider_application_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_provider_documents" (
    "id" TEXT NOT NULL,
    "application_id" TEXT,
    "provider_id" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    "expires_on" DATE,
    "uploaded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_provider_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_provider_invitations" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "VpRole" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "accepted_by_id" TEXT,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_provider_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_service_categories" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "required_documents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "qualifications" TEXT NOT NULL DEFAULT '',
    "evidence" TEXT NOT NULL DEFAULT '',
    "finding_kind" TEXT NOT NULL DEFAULT 'MIXED',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_service_categories_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "verification_provider_services" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "category_code" TEXT NOT NULL,
    "price_kobo" BIGINT,
    "turnaround_days" INTEGER NOT NULL DEFAULT 10,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT NOT NULL DEFAULT '',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_provider_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_provider_coverage" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "area" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_provider_coverage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "verification_provider_applications_ref_key" ON "verification_provider_applications"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "verification_provider_applications_provider_id_key" ON "verification_provider_applications"("provider_id");

-- CreateIndex
CREATE INDEX "verification_provider_applications_status_submitted_at_idx" ON "verification_provider_applications"("status", "submitted_at");

-- CreateIndex
CREATE INDEX "verification_provider_applications_applicant_id_idx" ON "verification_provider_applications"("applicant_id");

-- CreateIndex
CREATE INDEX "verification_provider_application_events_application_id_cre_idx" ON "verification_provider_application_events"("application_id", "created_at");

-- CreateIndex
CREATE INDEX "verification_provider_documents_application_id_idx" ON "verification_provider_documents"("application_id");

-- CreateIndex
CREATE INDEX "verification_provider_documents_provider_id_idx" ON "verification_provider_documents"("provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "verification_provider_invitations_token_hash_key" ON "verification_provider_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "verification_provider_invitations_provider_id_idx" ON "verification_provider_invitations"("provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "verification_provider_services_provider_id_category_code_key" ON "verification_provider_services"("provider_id", "category_code");

-- CreateIndex
CREATE INDEX "verification_provider_coverage_state_idx" ON "verification_provider_coverage"("state");

-- CreateIndex
CREATE UNIQUE INDEX "verification_provider_coverage_provider_id_state_area_key" ON "verification_provider_coverage"("provider_id", "state", "area");

-- CreateIndex
CREATE UNIQUE INDEX "service_providers_provider_code_key" ON "service_providers"("provider_code");

-- Members of a provider that no longer exists cannot be kept once the link is enforced.
DELETE FROM "provider_members" m WHERE NOT EXISTS (SELECT 1 FROM "service_providers" p WHERE p.id = m.provider_id);

-- AddForeignKey
ALTER TABLE "provider_members" ADD CONSTRAINT "provider_members_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "service_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_provider_applications" ADD CONSTRAINT "verification_provider_applications_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "service_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_provider_application_events" ADD CONSTRAINT "verification_provider_application_events_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "verification_provider_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_provider_documents" ADD CONSTRAINT "verification_provider_documents_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "verification_provider_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_provider_documents" ADD CONSTRAINT "verification_provider_documents_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "service_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_provider_invitations" ADD CONSTRAINT "verification_provider_invitations_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "service_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_provider_services" ADD CONSTRAINT "verification_provider_services_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "service_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Data that existed before ----------
-- People already added to a provider by platform administrators keep what they could do: run the provider's work.
UPDATE "provider_members" SET "role" = 'ADMIN';

-- The starting service categories. Housy can change them later; codes are permanent.
INSERT INTO "verification_service_categories" (code, name, summary, required_documents, qualifications, evidence, finding_kind, position) VALUES
  ('TITLE', 'Ownership and title investigation', 'Who holds title, by what instrument, and whether the chain of title is complete.', ARRAY['Title document (C of O, deed, governor''s consent or similar)','Seller''s identification']::TEXT[], 'Legal practitioner or title investigation professional', 'Copies of instruments examined; search reports', 'MIXED', 0),
  ('REGISTRY_SEARCH', 'Land registry search', 'An official search of the land registry for the property.', ARRAY['Title document or registry particulars']::TEXT[], 'Authorised to conduct registry searches in the state', 'Official search report or receipt', 'REGISTRY', 1),
  ('ENCUMBRANCE', 'Encumbrances and existing interests', 'Mortgages, charges, caveats, leases and other interests registered against the property.', ARRAY['Registry particulars']::TEXT[], 'Legal practitioner or title investigation professional', 'Registry search report', 'REGISTRY', 2),
  ('SURVEY_PLAN', 'Survey plan examination', 'Whether the survey plan is registered, consistent and matches the land offered.', ARRAY['Survey plan']::TEXT[], 'Registered surveyor (SURCON)', 'Survey plan copy; charting result from the surveyor-general', 'MIXED', 3),
  ('BOUNDARY', 'Boundary and location verification', 'Whether the beacons and boundaries on the ground match the survey plan.', ARRAY['Survey plan']::TEXT[], 'Registered surveyor (SURCON)', 'Beacon photographs with coordinates; field notes', 'PHYSICAL', 4),
  ('SITE_INSPECTION', 'Physical site inspection', 'A visit to the property: access, occupation, condition and surroundings.', ARRAY[]::TEXT[], 'Trained field investigator', 'Dated photographs with location; inspection checklist', 'PHYSICAL', 5),
  ('STRUCTURAL', 'Building and structural condition', 'The condition of the building and any visible structural concerns.', ARRAY['Building plans, if available']::TEXT[], 'Registered engineer (COREN) or builder', 'Photographs; condition schedule', 'OPINION', 6),
  ('PLANNING', 'Planning permission and approvals', 'Whether the building or development has the required approvals.', ARRAY['Approved building plan, if claimed']::TEXT[], 'Town planner (TOPREC) or authorised professional', 'Approval copies; enquiry results from the planning authority', 'MIXED', 7),
  ('LITIGATION', 'Litigation and dispute checks', 'Court cases, disputes or claims involving the property or its owner.', ARRAY['Owner''s full name']::TEXT[], 'Legal practitioner', 'Court registry search results', 'REGISTRY', 8),
  ('ZONING', 'Land use and zoning', 'What the land may be used for under the applicable master plan or zoning.', ARRAY[]::TEXT[], 'Town planner (TOPREC)', 'Zoning information from the planning authority', 'MIXED', 9),
  ('VALUATION', 'Property valuation', 'A formal valuation of the property.', ARRAY['Title document','Building plans, if available']::TEXT[], 'Estate surveyor and valuer (ESVARBON)', 'Valuation report with comparables', 'OPINION', 10),
  ('MARKET_PRICE', 'Market price assessment', 'Whether the asking price is in line with the local market.', ARRAY[]::TEXT[], 'Estate surveyor and valuer, or market analyst', 'Comparable sales and listings', 'OPINION', 11),
  ('OWNERSHIP_HISTORY', 'Ownership history', 'Past owners and transfers, as far as records allow.', ARRAY['Title documents in the chain']::TEXT[], 'Legal practitioner or title investigation professional', 'Instruments and search reports', 'MIXED', 12),
  ('SELLER_DUE_DILIGENCE', 'Developer and seller due diligence', 'Whether the seller or developer is who they say they are and is in good standing.', ARRAY['Seller''s or developer''s identification and registration']::TEXT[], 'Due diligence professional', 'Registration searches; identity checks', 'MIXED', 13),
  ('ENVIRONMENTAL', 'Environmental and location risk', 'Flooding, erosion, setbacks, right-of-way and similar location risks.', ARRAY[]::TEXT[], 'Qualified environmental or planning professional', 'Site photographs; authority records; maps', 'MIXED', 14),
  ('GENERAL', 'General property due diligence', 'A combined first look across title, site and seller, with recommendations for deeper checks.', ARRAY['Any documents the seller has provided']::TEXT[], 'Due diligence professional', 'As each part requires', 'MIXED', 15)
ON CONFLICT (code) DO NOTHING;

-- ---------- Row-level security: each provider sees only its own ----------

-- The signed-in person's role in a provider organisation, or null. Reads only the person's own membership rows.
CREATE OR REPLACE FUNCTION app_provider_role(pid text) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.role::text FROM provider_members m
   WHERE m.provider_id = pid AND m.user_id = app_current_user() AND m.status = 'ACTIVE' LIMIT 1 $$;

-- The membership lookup reads provider_members as its owner, which must not itself be held by the table's policies (they
-- call this function: forcing them on the owner would loop). The app's own role is still held by every policy.
ALTER TABLE "provider_members" NO FORCE ROW LEVEL SECURITY;

-- Whether a provider may work: approved by Housy and not suspended. A suspended provider keeps its records, read-only.
CREATE OR REPLACE FUNCTION app_provider_active(pid text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM service_providers p WHERE p.id = pid AND p.status = 'APPROVED' AND p.suspended_at IS NULL) $$;

-- Applications: the applicant sees and edits their own (and can never mark it approved); the approved organisation's
-- owners and administrators can read it; Housy's administrators do everything else.
ALTER TABLE "verification_provider_applications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_provider_applications" FORCE ROW LEVEL SECURITY;
CREATE POLICY applicant_read ON "verification_provider_applications" FOR SELECT USING (applicant_id = app_current_user());
CREATE POLICY applicant_create ON "verification_provider_applications" FOR INSERT WITH CHECK (applicant_id = app_current_user() AND status = 'DRAFT');
CREATE POLICY applicant_update ON "verification_provider_applications" FOR UPDATE
  USING (applicant_id = app_current_user() AND status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'ADDITIONAL_INFORMATION_REQUIRED', 'RESUBMITTED'))
  WITH CHECK (applicant_id = app_current_user() AND status IN ('DRAFT', 'SUBMITTED', 'ADDITIONAL_INFORMATION_REQUIRED', 'RESUBMITTED', 'WITHDRAWN') AND provider_id IS NULL AND decided_by_id IS NULL);
CREATE POLICY organisation_read ON "verification_provider_applications" FOR SELECT USING (provider_id IS NOT NULL AND app_provider_role(provider_id) IN ('OWNER', 'ADMIN'));
CREATE POLICY platform_admin ON "verification_provider_applications" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

-- The application's history: the applicant sees everything except Housy's internal notes, and adds their own steps.
ALTER TABLE "verification_provider_application_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_provider_application_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY applicant_read ON "verification_provider_application_events" FOR SELECT
  USING (NOT internal AND application_id IN (SELECT a.id FROM verification_provider_applications a WHERE a.applicant_id = app_current_user()));
CREATE POLICY applicant_add ON "verification_provider_application_events" FOR INSERT
  WITH CHECK (NOT internal AND actor_id = app_current_user() AND application_id IN (SELECT a.id FROM verification_provider_applications a WHERE a.applicant_id = app_current_user()));
CREATE POLICY platform_admin ON "verification_provider_application_events" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

-- Documents: an applicant's own (added or removed only while the application can be changed), an organisation's own
-- (seen by its members, managed by its owners and administrators while it may work), and Housy's administrators.
ALTER TABLE "verification_provider_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_provider_documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY applicant_read ON "verification_provider_documents" FOR SELECT
  USING (application_id IN (SELECT a.id FROM verification_provider_applications a WHERE a.applicant_id = app_current_user()));
CREATE POLICY applicant_add ON "verification_provider_documents" FOR INSERT
  WITH CHECK (provider_id IS NULL AND uploaded_by_id = app_current_user() AND application_id IN (SELECT a.id FROM verification_provider_applications a WHERE a.applicant_id = app_current_user() AND a.status IN ('DRAFT', 'ADDITIONAL_INFORMATION_REQUIRED')));
CREATE POLICY applicant_remove ON "verification_provider_documents" FOR DELETE
  USING (provider_id IS NULL AND application_id IN (SELECT a.id FROM verification_provider_applications a WHERE a.applicant_id = app_current_user() AND a.status IN ('DRAFT', 'ADDITIONAL_INFORMATION_REQUIRED')));
CREATE POLICY organisation_read ON "verification_provider_documents" FOR SELECT USING (provider_id IS NOT NULL AND app_provider_role(provider_id) IS NOT NULL);
CREATE POLICY organisation_add ON "verification_provider_documents" FOR INSERT
  WITH CHECK (application_id IS NULL AND provider_id IS NOT NULL AND uploaded_by_id = app_current_user() AND app_provider_role(provider_id) IN ('OWNER', 'ADMIN') AND app_provider_active(provider_id));
CREATE POLICY organisation_remove ON "verification_provider_documents" FOR DELETE
  USING (application_id IS NULL AND provider_id IS NOT NULL AND app_provider_role(provider_id) IN ('OWNER', 'ADMIN') AND app_provider_active(provider_id));
CREATE POLICY platform_admin ON "verification_provider_documents" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

-- Invitations: managed by the organisation's owners and administrators (an administrator cannot invite an owner or an
-- administrator); read and accepted by whoever holds the link; Housy's administrators create the first owner's.
ALTER TABLE "verification_provider_invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_provider_invitations" FORCE ROW LEVEL SECURITY;
CREATE POLICY organisation_read ON "verification_provider_invitations" FOR SELECT USING (app_provider_role(provider_id) IN ('OWNER', 'ADMIN'));
CREATE POLICY organisation_invite ON "verification_provider_invitations" FOR INSERT
  WITH CHECK (invited_by_id = app_current_user() AND app_provider_active(provider_id)
    AND (app_provider_role(provider_id) = 'OWNER' OR (app_provider_role(provider_id) = 'ADMIN' AND role NOT IN ('OWNER', 'ADMIN'))));
CREATE POLICY organisation_revoke ON "verification_provider_invitations" FOR UPDATE
  USING (app_provider_role(provider_id) = 'OWNER' OR (app_provider_role(provider_id) = 'ADMIN' AND role NOT IN ('OWNER', 'ADMIN')))
  WITH CHECK (app_provider_role(provider_id) = 'OWNER' OR (app_provider_role(provider_id) = 'ADMIN' AND role NOT IN ('OWNER', 'ADMIN')));
CREATE POLICY link_read ON "verification_provider_invitations" FOR SELECT USING (token_hash = app_invite_token());
CREATE POLICY link_accept ON "verification_provider_invitations" FOR UPDATE
  USING (token_hash = app_invite_token() AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now())
  WITH CHECK (token_hash = app_invite_token() AND accepted_by_id = app_current_user());
CREATE POLICY platform_admin ON "verification_provider_invitations" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

-- Members: colleagues see each other; owners manage everyone, administrators manage everyone but owners and
-- administrators; a person with a valid invitation link joins in exactly the invited role.
CREATE POLICY colleague_read ON "provider_members" FOR SELECT USING (app_provider_role(provider_id) IS NOT NULL);
CREATE POLICY organisation_manage ON "provider_members" FOR UPDATE
  USING (app_provider_active(provider_id) AND (app_provider_role(provider_id) = 'OWNER' OR (app_provider_role(provider_id) = 'ADMIN' AND role NOT IN ('OWNER', 'ADMIN'))))
  WITH CHECK (app_provider_active(provider_id) AND (app_provider_role(provider_id) = 'OWNER' OR (app_provider_role(provider_id) = 'ADMIN' AND role NOT IN ('OWNER', 'ADMIN'))));
CREATE POLICY organisation_remove ON "provider_members" FOR DELETE
  USING (app_provider_active(provider_id) AND (app_provider_role(provider_id) = 'OWNER' OR (app_provider_role(provider_id) = 'ADMIN' AND role NOT IN ('OWNER', 'ADMIN'))));
CREATE POLICY join_by_invitation ON "provider_members" FOR INSERT
  WITH CHECK (user_id = app_current_user() AND status = 'ACTIVE' AND EXISTS (
    SELECT 1 FROM verification_provider_invitations i
     WHERE i.provider_id = provider_members.provider_id AND i.token_hash = app_invite_token() AND i.role = provider_members.role
       AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()));

-- Service categories: everyone reads them; only Housy changes them.
ALTER TABLE "verification_service_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_service_categories" FORCE ROW LEVEL SECURITY;
CREATE POLICY everyone_read ON "verification_service_categories" FOR SELECT USING (true);
CREATE POLICY platform_admin ON "verification_service_categories" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

-- What an organisation offers and where: public for a working provider, managed by its owners and administrators, and
-- only within what Housy allows it.
ALTER TABLE "verification_provider_services" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_provider_services" FORCE ROW LEVEL SECURITY;
CREATE POLICY public_read ON "verification_provider_services" FOR SELECT USING (app_provider_active(provider_id) OR app_provider_role(provider_id) IS NOT NULL);
CREATE POLICY organisation_manage ON "verification_provider_services" FOR ALL
  USING (app_provider_role(provider_id) IN ('OWNER', 'ADMIN') AND app_provider_active(provider_id))
  WITH CHECK (app_provider_role(provider_id) IN ('OWNER', 'ADMIN') AND app_provider_active(provider_id)
    AND category_code = ANY (SELECT unnest(p.allowed_services) FROM service_providers p WHERE p.id = provider_id));
CREATE POLICY platform_admin ON "verification_provider_services" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "verification_provider_coverage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_provider_coverage" FORCE ROW LEVEL SECURITY;
CREATE POLICY public_read ON "verification_provider_coverage" FOR SELECT USING (app_provider_active(provider_id) OR app_provider_role(provider_id) IS NOT NULL);
CREATE POLICY organisation_manage ON "verification_provider_coverage" FOR ALL
  USING (app_provider_role(provider_id) IN ('OWNER', 'ADMIN') AND app_provider_active(provider_id))
  WITH CHECK (app_provider_role(provider_id) IN ('OWNER', 'ADMIN') AND app_provider_active(provider_id)
    AND state = ANY (SELECT unnest(p.allowed_states) FROM service_providers p WHERE p.id = provider_id));
CREATE POLICY platform_admin ON "verification_provider_coverage" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
