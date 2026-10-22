-- AlterTable
ALTER TABLE "provider_leads" ADD COLUMN     "provider_note" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "portal_grants" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "user_id" TEXT,
    "contractor_id" TEXT,
    "invite_token_hash" TEXT,
    "invite_expires_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'INVITED',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "portal_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_grant_assets" (
    "id" TEXT NOT NULL,
    "grant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,

    CONSTRAINT "portal_grant_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_profiles" (
    "id" TEXT NOT NULL,
    "grant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "service_areas" TEXT NOT NULL DEFAULT '',
    "qualifications" TEXT NOT NULL DEFAULT '',
    "insurance_note" TEXT NOT NULL DEFAULT '',
    "doc_name" TEXT NOT NULL DEFAULT '',
    "doc_mime" TEXT,
    "doc_bytes" BYTEA,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_submissions" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "work_order_id" TEXT NOT NULL,
    "grant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount_kobo" BIGINT,
    "note" TEXT NOT NULL DEFAULT '',
    "doc_name" TEXT NOT NULL DEFAULT '',
    "doc_mime" TEXT,
    "doc_bytes" BYTEA,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_members" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "added_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "portal_grants_invite_token_hash_key" ON "portal_grants"("invite_token_hash");
CREATE INDEX "portal_grants_company_id_kind_idx" ON "portal_grants"("company_id", "kind");
CREATE INDEX "portal_grants_user_id_idx" ON "portal_grants"("user_id");
CREATE UNIQUE INDEX "portal_grant_assets_grant_id_asset_id_key" ON "portal_grant_assets"("grant_id", "asset_id");
CREATE INDEX "portal_grant_assets_company_id_idx" ON "portal_grant_assets"("company_id");
CREATE UNIQUE INDEX "vendor_profiles_grant_id_key" ON "vendor_profiles"("grant_id");
CREATE INDEX "vendor_profiles_company_id_idx" ON "vendor_profiles"("company_id");
CREATE INDEX "vendor_submissions_company_id_work_order_id_idx" ON "vendor_submissions"("company_id", "work_order_id");
CREATE INDEX "vendor_submissions_grant_id_idx" ON "vendor_submissions"("grant_id");
CREATE UNIQUE INDEX "provider_members_provider_id_user_id_key" ON "provider_members"("provider_id", "user_id");
CREATE INDEX "provider_members_user_id_idx" ON "provider_members"("user_id");

ALTER TABLE "portal_grants" ADD CONSTRAINT portal_grants_state CHECK (
  kind IN ('OWNER', 'VENDOR') AND status IN ('INVITED', 'ACTIVE', 'REVOKED')
  AND char_length(email) BETWEEN 3 AND 160 AND char_length(display_name) BETWEEN 2 AND 120
  AND (kind <> 'VENDOR' OR contractor_id IS NOT NULL)
  AND (status <> 'ACTIVE' OR user_id IS NOT NULL)
);
ALTER TABLE "vendor_profiles" ADD CONSTRAINT vendor_profiles_state CHECK (
  char_length(service_areas) <= 500 AND char_length(qualifications) <= 2000 AND char_length(insurance_note) <= 500 AND char_length(doc_name) <= 200
  AND ((doc_mime IS NULL AND doc_bytes IS NULL) OR (doc_mime IN ('application/pdf', 'image/png', 'image/jpeg', 'image/webp') AND octet_length(doc_bytes) BETWEEN 1 AND 4194304))
);
ALTER TABLE "vendor_submissions" ADD CONSTRAINT vendor_submissions_state CHECK (
  kind IN ('QUOTE', 'INVOICE', 'COMPLETION') AND status IN ('SUBMITTED', 'ACCEPTED', 'REJECTED')
  AND (amount_kobo IS NULL OR amount_kobo >= 0) AND (kind = 'COMPLETION' OR amount_kobo IS NOT NULL)
  AND char_length(note) <= 2000 AND char_length(decision_note) <= 1000 AND char_length(doc_name) <= 200
  AND ((doc_mime IS NULL AND doc_bytes IS NULL) OR (doc_mime IN ('application/pdf', 'image/png', 'image/jpeg', 'image/webp') AND octet_length(doc_bytes) BETWEEN 1 AND 4194304))
);

-- The company manages its grants and sees everything about them. The portal user sees only their own grant and what hangs off it.
ALTER TABLE "portal_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_grants" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "portal_grants" FOR ALL USING (company_id = app_current_company()) WITH CHECK (company_id = app_current_company());
CREATE POLICY grantee_read ON "portal_grants" FOR SELECT USING (user_id = app_current_user());
CREATE POLICY by_invite ON "portal_grants" FOR SELECT USING (invite_token_hash = app_invite_token());
CREATE POLICY accept_invite ON "portal_grants" FOR UPDATE USING (invite_token_hash = app_invite_token() AND status = 'INVITED') WITH CHECK (user_id = app_current_user() AND status = 'ACTIVE');
CREATE POLICY platform_admin_read ON "portal_grants" FOR SELECT USING (app_platform_admin());

ALTER TABLE "portal_grant_assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_grant_assets" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "portal_grant_assets" FOR ALL USING (company_id = app_current_company()) WITH CHECK (company_id = app_current_company());
CREATE POLICY grantee_read ON "portal_grant_assets" FOR SELECT USING (EXISTS (SELECT 1 FROM portal_grants g WHERE g.id = grant_id AND g.user_id = app_current_user() AND g.status = 'ACTIVE'));

ALTER TABLE "vendor_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vendor_profiles" FORCE ROW LEVEL SECURITY;
CREATE POLICY company_read ON "vendor_profiles" FOR SELECT USING (company_id = app_current_company());
CREATE POLICY own_profile ON "vendor_profiles" FOR ALL USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user() AND EXISTS (SELECT 1 FROM portal_grants g WHERE g.id = grant_id AND g.user_id = app_current_user() AND g.status = 'ACTIVE' AND g.kind = 'VENDOR' AND g.company_id = vendor_profiles.company_id));

ALTER TABLE "vendor_submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vendor_submissions" FORCE ROW LEVEL SECURITY;
CREATE POLICY company_review ON "vendor_submissions" FOR ALL USING (company_id = app_current_company()) WITH CHECK (company_id = app_current_company());
CREATE POLICY vendor_own_read ON "vendor_submissions" FOR SELECT USING (user_id = app_current_user());
CREATE POLICY vendor_submit ON "vendor_submissions" FOR INSERT WITH CHECK (user_id = app_current_user() AND status = 'SUBMITTED' AND decided_by_id IS NULL
  AND EXISTS (SELECT 1 FROM portal_grants g WHERE g.id = grant_id AND g.user_id = app_current_user() AND g.status = 'ACTIVE' AND g.kind = 'VENDOR' AND g.company_id = vendor_submissions.company_id));

-- Provider members are set by platform administrators; a member can see their own membership.
ALTER TABLE "provider_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "provider_members" FORCE ROW LEVEL SECURITY;
CREATE POLICY own_read ON "provider_members" FOR SELECT USING (user_id = app_current_user());
CREATE POLICY platform_admin ON "provider_members" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
