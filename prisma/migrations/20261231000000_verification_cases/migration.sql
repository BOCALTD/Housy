-- The verification network, stages 4 to 6: customers' verification requests and the cases they become, offers to
-- providers, the case history, documents and evidence, inspections, reports with versions that never change once released,
-- and conflict-of-interest declarations; guards and row-level security.

-- CreateEnum
CREATE TYPE "VpCaseStatus" AS ENUM ('REQUESTED', 'PENDING_PAYMENT', 'READY_FOR_ASSIGNMENT', 'ASSIGNED', 'ACCEPTED', 'DOCUMENT_REVIEW', 'INFORMATION_REQUIRED', 'FIELD_INSPECTION', 'INVESTIGATION_IN_PROGRESS', 'REPORT_DRAFT', 'INTERNAL_REVIEW', 'CORRECTION_REQUIRED', 'SUBMITTED_TO_HOUSY', 'PLATFORM_REVIEW', 'APPROVED_FOR_RELEASE', 'DELIVERED', 'COMPLETED', 'REJECTED', 'CANCELLED', 'DISPUTED');

-- CreateTable
CREATE TABLE "verification_cases" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "listing_id" TEXT,
    "listing_ref" TEXT NOT NULL DEFAULT '',
    "property_address" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "area" TEXT NOT NULL DEFAULT '',
    "property_type" TEXT NOT NULL,
    "services" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "documents_available" TEXT NOT NULL DEFAULT '',
    "owner_details" TEXT NOT NULL DEFAULT '',
    "transaction_context" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" "VpCaseStatus" NOT NULL DEFAULT 'REQUESTED',
    "provider_id" TEXT,
    "officer_id" TEXT,
    "reviewer_id" TEXT,
    "selection_method" TEXT NOT NULL DEFAULT '',
    "preferred_provider_id" TEXT,
    "required_by" TIMESTAMP(3),
    "accept_by" TIMESTAMP(3),
    "info_request" TEXT NOT NULL DEFAULT '',
    "closing_note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "verification_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_assignments" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "assigned_by_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'OFFERED',
    "decline_reason" TEXT NOT NULL DEFAULT '',
    "respond_by" TIMESTAMP(3) NOT NULL,
    "decided_at" TIMESTAMP(3),
    "decided_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_case_activities" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "provider_id" TEXT,
    "actor_id" TEXT NOT NULL,
    "actor_kind" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "from_status" TEXT NOT NULL DEFAULT '',
    "to_status" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "visible_to_customer" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_case_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_case_documents" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "provider_id" TEXT,
    "kind" TEXT NOT NULL,
    "basis" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "caption" TEXT NOT NULL DEFAULT '',
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "taken_at" TIMESTAMP(3),
    "uploaded_by_id" TEXT NOT NULL,
    "uploader_kind" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_case_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_inspections" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "officer_id" TEXT NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_reports" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "public_ref" TEXT NOT NULL,
    "released_version" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_report_versions" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL DEFAULT '{}',
    "outcome" TEXT NOT NULL DEFAULT '',
    "prepared_by_id" TEXT NOT NULL,
    "reviewed_by_id" TEXT,
    "review_note" TEXT NOT NULL DEFAULT '',
    "provider_approved_at" TIMESTAMP(3),
    "platform_reviewer_id" TEXT,
    "platform_note" TEXT NOT NULL DEFAULT '',
    "platform_approved_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "sha256" TEXT NOT NULL DEFAULT '',
    "correction_of" INTEGER,
    "correction_reason" TEXT NOT NULL DEFAULT '',
    "superseded_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_report_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_conflict_declarations" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "declared_by_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_conflict_declarations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "verification_cases_ref_key" ON "verification_cases"("ref");

-- CreateIndex
CREATE INDEX "verification_cases_provider_id_status_idx" ON "verification_cases"("provider_id", "status");

-- CreateIndex
CREATE INDEX "verification_cases_requester_id_idx" ON "verification_cases"("requester_id");

-- CreateIndex
CREATE INDEX "verification_cases_status_created_at_idx" ON "verification_cases"("status", "created_at");

-- CreateIndex
CREATE INDEX "verification_assignments_case_id_idx" ON "verification_assignments"("case_id");

-- CreateIndex
CREATE INDEX "verification_assignments_provider_id_status_idx" ON "verification_assignments"("provider_id", "status");

-- CreateIndex
CREATE INDEX "verification_case_activities_case_id_created_at_idx" ON "verification_case_activities"("case_id", "created_at");

-- CreateIndex
CREATE INDEX "verification_case_documents_case_id_idx" ON "verification_case_documents"("case_id");

-- CreateIndex
CREATE INDEX "verification_inspections_case_id_idx" ON "verification_inspections"("case_id");

-- CreateIndex
CREATE UNIQUE INDEX "verification_reports_case_id_key" ON "verification_reports"("case_id");

-- CreateIndex
CREATE UNIQUE INDEX "verification_reports_public_ref_key" ON "verification_reports"("public_ref");

-- CreateIndex
CREATE UNIQUE INDEX "verification_report_versions_report_id_version_key" ON "verification_report_versions"("report_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "verification_conflict_declarations_provider_id_case_id_key" ON "verification_conflict_declarations"("provider_id", "case_id");

-- AddForeignKey
ALTER TABLE "verification_assignments" ADD CONSTRAINT "verification_assignments_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "verification_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_case_activities" ADD CONSTRAINT "verification_case_activities_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "verification_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_case_documents" ADD CONSTRAINT "verification_case_documents_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "verification_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_inspections" ADD CONSTRAINT "verification_inspections_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "verification_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_reports" ADD CONSTRAINT "verification_reports_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "verification_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_report_versions" ADD CONSTRAINT "verification_report_versions_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "verification_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Guards the database keeps, whoever writes ----------

-- A case moves only along the allowed steps (the same as src/lib/verification-case-rules.ts; a unit test keeps them equal),
-- keeps its requester and reference, and is assigned to a provider only by Housy. A provider declining hands it back.
CREATE OR REPLACE FUNCTION verification_case_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.requester_id <> OLD.requester_id OR NEW.ref <> OLD.ref THEN
    RAISE EXCEPTION 'A verification case keeps its requester and reference';
  END IF;
  IF NEW.provider_id IS DISTINCT FROM OLD.provider_id AND NOT app_platform_admin()
     AND NOT (NEW.provider_id IS NULL AND OLD.status = 'ASSIGNED' AND NEW.status = 'READY_FOR_ASSIGNMENT') THEN
    RAISE EXCEPTION 'Only Housy assigns a verification case to a provider';
  END IF;
  IF NEW.status <> OLD.status AND NOT EXISTS (
    SELECT 1 FROM (VALUES ('REQUESTED','PENDING_PAYMENT'), ('REQUESTED','READY_FOR_ASSIGNMENT'), ('REQUESTED','REJECTED'), ('REQUESTED','CANCELLED'), ('PENDING_PAYMENT','READY_FOR_ASSIGNMENT'), ('PENDING_PAYMENT','CANCELLED'), ('READY_FOR_ASSIGNMENT','ASSIGNED'), ('READY_FOR_ASSIGNMENT','REJECTED'), ('READY_FOR_ASSIGNMENT','CANCELLED'), ('ASSIGNED','READY_FOR_ASSIGNMENT'), ('ASSIGNED','ACCEPTED'), ('ASSIGNED','CANCELLED'), ('ACCEPTED','DOCUMENT_REVIEW'), ('ACCEPTED','CANCELLED'), ('DOCUMENT_REVIEW','INFORMATION_REQUIRED'), ('DOCUMENT_REVIEW','FIELD_INSPECTION'), ('DOCUMENT_REVIEW','INVESTIGATION_IN_PROGRESS'), ('DOCUMENT_REVIEW','CANCELLED'), ('INFORMATION_REQUIRED','DOCUMENT_REVIEW'), ('INFORMATION_REQUIRED','CANCELLED'), ('FIELD_INSPECTION','INVESTIGATION_IN_PROGRESS'), ('FIELD_INSPECTION','CANCELLED'), ('INVESTIGATION_IN_PROGRESS','INFORMATION_REQUIRED'), ('INVESTIGATION_IN_PROGRESS','FIELD_INSPECTION'), ('INVESTIGATION_IN_PROGRESS','REPORT_DRAFT'), ('INVESTIGATION_IN_PROGRESS','CANCELLED'), ('REPORT_DRAFT','INTERNAL_REVIEW'), ('REPORT_DRAFT','CANCELLED'), ('INTERNAL_REVIEW','CORRECTION_REQUIRED'), ('INTERNAL_REVIEW','SUBMITTED_TO_HOUSY'), ('INTERNAL_REVIEW','CANCELLED'), ('CORRECTION_REQUIRED','REPORT_DRAFT'), ('CORRECTION_REQUIRED','CANCELLED'), ('SUBMITTED_TO_HOUSY','PLATFORM_REVIEW'), ('PLATFORM_REVIEW','CORRECTION_REQUIRED'), ('PLATFORM_REVIEW','APPROVED_FOR_RELEASE'), ('PLATFORM_REVIEW','CANCELLED'), ('APPROVED_FOR_RELEASE','DELIVERED'), ('DELIVERED','COMPLETED'), ('DELIVERED','DISPUTED'), ('DISPUTED','PLATFORM_REVIEW'), ('DISPUTED','COMPLETED')) AS m(f, t)
     WHERE m.f = OLD.status::text AND m.t = NEW.status::text) THEN
    RAISE EXCEPTION 'A verification case cannot move from % to %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER verification_case_guard BEFORE UPDATE ON "verification_cases" FOR EACH ROW EXECUTE FUNCTION verification_case_guard();

-- A report version is never deleted. Once the provider has approved it for Housy, its content is fixed; once released to the
-- customer, nothing about it changes except being marked superseded or revoked (a correction is a new version).
CREATE OR REPLACE FUNCTION verification_report_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A report version is kept for ever'; END IF;
  IF OLD.provider_approved_at IS NOT NULL AND (NEW.content IS DISTINCT FROM OLD.content OR NEW.outcome IS DISTINCT FROM OLD.outcome OR NEW.prepared_by_id IS DISTINCT FROM OLD.prepared_by_id) THEN
    RAISE EXCEPTION 'An approved report version cannot be edited; make a new version';
  END IF;
  IF OLD.released_at IS NOT NULL AND (
       NEW.released_at IS DISTINCT FROM OLD.released_at OR NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.reviewed_by_id IS DISTINCT FROM OLD.reviewed_by_id OR NEW.provider_approved_at IS DISTINCT FROM OLD.provider_approved_at
    OR NEW.platform_reviewer_id IS DISTINCT FROM OLD.platform_reviewer_id OR NEW.platform_approved_at IS DISTINCT FROM OLD.platform_approved_at
    OR NEW.review_note IS DISTINCT FROM OLD.review_note OR NEW.platform_note IS DISTINCT FROM OLD.platform_note
    OR (OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at)
    OR (OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoked_reason IS DISTINCT FROM OLD.revoked_reason))) THEN
    RAISE EXCEPTION 'A released report is never altered; issue a corrected version instead';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER verification_report_version_guard BEFORE UPDATE OR DELETE ON "verification_report_versions" FOR EACH ROW EXECUTE FUNCTION verification_report_version_guard();

-- ---------- Row-level security ----------
-- A provider sees a case only while it is assigned to it; its field investigators see only the cases given to them. The
-- customer sees their own cases, the steps meant for them, their own documents and only released reports.

ALTER TABLE "verification_cases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_cases" FORCE ROW LEVEL SECURITY;
CREATE POLICY requester_read ON "verification_cases" FOR SELECT USING (requester_id = app_current_user());
CREATE POLICY requester_create ON "verification_cases" FOR INSERT WITH CHECK (requester_id = app_current_user() AND status = 'REQUESTED' AND provider_id IS NULL);
CREATE POLICY requester_update ON "verification_cases" FOR UPDATE
  USING (requester_id = app_current_user() AND status IN ('REQUESTED', 'PENDING_PAYMENT', 'READY_FOR_ASSIGNMENT', 'INFORMATION_REQUIRED', 'DELIVERED'))
  WITH CHECK (requester_id = app_current_user());
CREATE POLICY provider_read ON "verification_cases" FOR SELECT
  USING (provider_id IS NOT NULL AND (app_provider_role(provider_id) IN ('OWNER', 'ADMIN', 'MANAGER', 'REVIEWER', 'FINANCE')
    OR (app_provider_role(provider_id) IS NOT NULL AND (officer_id = app_current_user() OR reviewer_id = app_current_user()))));
CREATE POLICY provider_update ON "verification_cases" FOR UPDATE
  USING (provider_id IS NOT NULL AND app_provider_active(provider_id) AND (app_provider_role(provider_id) IN ('OWNER', 'ADMIN', 'MANAGER', 'REVIEWER')
    OR (app_provider_role(provider_id) = 'INVESTIGATOR' AND officer_id = app_current_user())))
  WITH CHECK ((provider_id IS NULL AND status = 'READY_FOR_ASSIGNMENT') OR app_provider_role(provider_id) IS NOT NULL);
CREATE POLICY platform_admin ON "verification_cases" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "verification_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_read ON "verification_assignments" FOR SELECT USING (app_provider_role(provider_id) IN ('OWNER', 'ADMIN', 'MANAGER'));
CREATE POLICY provider_answer ON "verification_assignments" FOR UPDATE
  USING (status = 'OFFERED' AND app_provider_role(provider_id) IN ('OWNER', 'ADMIN', 'MANAGER') AND app_provider_active(provider_id))
  WITH CHECK (status IN ('ACCEPTED', 'DECLINED') AND decided_by_id = app_current_user() AND app_provider_role(provider_id) IN ('OWNER', 'ADMIN', 'MANAGER'));
CREATE POLICY platform_admin ON "verification_assignments" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "verification_case_activities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_case_activities" FORCE ROW LEVEL SECURITY;
CREATE POLICY requester_read ON "verification_case_activities" FOR SELECT
  USING (visible_to_customer AND case_id IN (SELECT c.id FROM verification_cases c WHERE c.requester_id = app_current_user()));
CREATE POLICY requester_add ON "verification_case_activities" FOR INSERT
  WITH CHECK (actor_kind = 'customer' AND actor_id = app_current_user() AND provider_id IS NULL AND visible_to_customer
    AND case_id IN (SELECT c.id FROM verification_cases c WHERE c.requester_id = app_current_user()));
CREATE POLICY provider_read ON "verification_case_activities" FOR SELECT
  USING (provider_id IS NOT NULL AND app_provider_role(provider_id) IS NOT NULL AND case_id IN (SELECT c.id FROM verification_cases c WHERE c.provider_id = verification_case_activities.provider_id));
CREATE POLICY provider_add ON "verification_case_activities" FOR INSERT
  WITH CHECK (actor_kind = 'provider' AND actor_id = app_current_user() AND provider_id IS NOT NULL AND app_provider_role(provider_id) IS NOT NULL
    AND case_id IN (SELECT c.id FROM verification_cases c WHERE c.provider_id = verification_case_activities.provider_id));
CREATE POLICY platform_admin ON "verification_case_activities" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "verification_case_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_case_documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY requester_read ON "verification_case_documents" FOR SELECT
  USING (uploader_kind = 'customer' AND case_id IN (SELECT c.id FROM verification_cases c WHERE c.requester_id = app_current_user()));
CREATE POLICY requester_add ON "verification_case_documents" FOR INSERT
  WITH CHECK (uploader_kind = 'customer' AND uploaded_by_id = app_current_user() AND provider_id IS NULL
    AND case_id IN (SELECT c.id FROM verification_cases c WHERE c.requester_id = app_current_user() AND c.status IN ('REQUESTED', 'PENDING_PAYMENT', 'READY_FOR_ASSIGNMENT', 'ASSIGNED', 'ACCEPTED', 'DOCUMENT_REVIEW', 'INFORMATION_REQUIRED')));
CREATE POLICY provider_read ON "verification_case_documents" FOR SELECT
  USING (case_id IN (SELECT c.id FROM verification_cases c WHERE c.provider_id IS NOT NULL AND app_provider_role(c.provider_id) IS NOT NULL));
CREATE POLICY provider_add ON "verification_case_documents" FOR INSERT
  WITH CHECK (uploader_kind = 'provider' AND uploaded_by_id = app_current_user() AND provider_id IS NOT NULL AND app_provider_active(provider_id)
    AND case_id IN (SELECT c.id FROM verification_cases c WHERE c.provider_id = verification_case_documents.provider_id));
CREATE POLICY uploader_remove ON "verification_case_documents" FOR DELETE
  USING (uploaded_by_id = app_current_user() AND case_id IN (SELECT c.id FROM verification_cases c WHERE c.status IN ('REQUESTED', 'READY_FOR_ASSIGNMENT', 'ACCEPTED', 'DOCUMENT_REVIEW', 'INFORMATION_REQUIRED', 'FIELD_INSPECTION', 'INVESTIGATION_IN_PROGRESS', 'REPORT_DRAFT', 'CORRECTION_REQUIRED')));
CREATE POLICY platform_admin ON "verification_case_documents" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "verification_inspections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_inspections" FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_read ON "verification_inspections" FOR SELECT USING (app_provider_role(provider_id) IS NOT NULL AND case_id IN (SELECT c.id FROM verification_cases c WHERE c.provider_id = verification_inspections.provider_id));
CREATE POLICY provider_write ON "verification_inspections" FOR ALL
  USING (app_provider_active(provider_id) AND app_provider_role(provider_id) IS NOT NULL AND case_id IN (SELECT c.id FROM verification_cases c WHERE c.provider_id = verification_inspections.provider_id))
  WITH CHECK (app_provider_active(provider_id) AND app_provider_role(provider_id) IS NOT NULL AND case_id IN (SELECT c.id FROM verification_cases c WHERE c.provider_id = verification_inspections.provider_id));
CREATE POLICY platform_admin ON "verification_inspections" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "verification_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_reports" FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_read ON "verification_reports" FOR SELECT USING (app_provider_role(provider_id) IS NOT NULL);
CREATE POLICY provider_create ON "verification_reports" FOR INSERT
  WITH CHECK (app_provider_active(provider_id) AND app_provider_role(provider_id) IS NOT NULL AND case_id IN (SELECT c.id FROM verification_cases c WHERE c.provider_id = verification_reports.provider_id));
CREATE POLICY requester_read ON "verification_reports" FOR SELECT
  USING (released_version IS NOT NULL AND case_id IN (SELECT c.id FROM verification_cases c WHERE c.requester_id = app_current_user()));
CREATE POLICY platform_admin ON "verification_reports" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "verification_report_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_report_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_read ON "verification_report_versions" FOR SELECT USING (app_provider_role(provider_id) IS NOT NULL);
CREATE POLICY provider_write ON "verification_report_versions" FOR INSERT
  WITH CHECK (released_at IS NULL AND platform_approved_at IS NULL AND app_provider_active(provider_id) AND app_provider_role(provider_id) IS NOT NULL
    AND case_id IN (SELECT c.id FROM verification_cases c WHERE c.provider_id = verification_report_versions.provider_id));
CREATE POLICY provider_edit ON "verification_report_versions" FOR UPDATE
  USING (released_at IS NULL AND platform_approved_at IS NULL AND app_provider_active(provider_id) AND app_provider_role(provider_id) IS NOT NULL
    AND case_id IN (SELECT c.id FROM verification_cases c WHERE c.provider_id = verification_report_versions.provider_id))
  WITH CHECK (released_at IS NULL AND platform_approved_at IS NULL AND app_provider_role(provider_id) IS NOT NULL);
CREATE POLICY requester_read ON "verification_report_versions" FOR SELECT
  USING (released_at IS NOT NULL AND case_id IN (SELECT c.id FROM verification_cases c WHERE c.requester_id = app_current_user()));
CREATE POLICY platform_admin ON "verification_report_versions" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());

ALTER TABLE "verification_conflict_declarations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_conflict_declarations" FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_read ON "verification_conflict_declarations" FOR SELECT USING (app_provider_role(provider_id) IS NOT NULL);
CREATE POLICY provider_declare ON "verification_conflict_declarations" FOR INSERT WITH CHECK (declared_by_id = app_current_user() AND app_provider_role(provider_id) IS NOT NULL);
CREATE POLICY platform_admin ON "verification_conflict_declarations" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
