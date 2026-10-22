-- CreateTable
CREATE TABLE "kyc_items" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "subject_kind" TEXT NOT NULL,
    "subject_key" TEXT NOT NULL,
    "subject_user_id" TEXT,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "fields" JSONB NOT NULL DEFAULT '{}',
    "secret_sealed" TEXT,
    "secret_masked" TEXT NOT NULL DEFAULT '',
    "doc_mime" TEXT,
    "doc_bytes" BYTEA,
    "doc_name" TEXT NOT NULL DEFAULT '',
    "submitted_by_id" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT NOT NULL DEFAULT '',
    "scope" TEXT NOT NULL DEFAULT '',
    "evidence" TEXT NOT NULL DEFAULT '',
    "limitations" TEXT NOT NULL DEFAULT '',
    "verified_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyc_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trust_scores" (
    "id" TEXT NOT NULL,
    "subject_key" TEXT NOT NULL,
    "subject_kind" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "subject_user_id" TEXT,
    "checks" JSONB NOT NULL DEFAULT '[]',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trust_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kyc_items_company_id_idx" ON "kyc_items"("company_id");

-- CreateIndex
CREATE INDEX "kyc_items_status_submitted_at_idx" ON "kyc_items"("status", "submitted_at");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_items_subject_key_code_key" ON "kyc_items"("subject_key", "code");

-- CreateIndex
CREATE UNIQUE INDEX "trust_scores_subject_key_key" ON "trust_scores"("subject_key");

-- CreateIndex
CREATE INDEX "trust_scores_company_id_idx" ON "trust_scores"("company_id");

-- CreateIndex
CREATE INDEX "trust_scores_subject_user_id_idx" ON "trust_scores"("subject_user_id");

ALTER TABLE "kyc_items" ADD CONSTRAINT kyc_items_state CHECK (
  subject_kind IN ('COMPANY', 'AGENT')
  AND ((subject_kind = 'COMPANY' AND subject_user_id IS NULL AND subject_key = 'COMPANY:' || company_id)
    OR (subject_kind = 'AGENT' AND subject_user_id IS NOT NULL AND subject_key = 'AGENT:' || subject_user_id))
  AND code ~ '^[A-Z_]{3,40}$'
  AND status IN ('SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'NEEDS_INFO', 'EXPIRED', 'REVOKED')
  AND ((doc_mime IS NULL AND doc_bytes IS NULL) OR (doc_mime IN ('application/pdf', 'image/png', 'image/jpeg', 'image/webp') AND octet_length(doc_bytes) BETWEEN 1 AND 4194304))
  AND char_length(secret_masked) <= 40 AND char_length(doc_name) <= 200 AND char_length(review_note) <= 1000
  AND char_length(scope) <= 300 AND char_length(evidence) <= 1000 AND char_length(limitations) <= 1000
  -- A check is only Verified with a reviewer, a date and the scope of what was checked (master prompt 8.1).
  AND (status <> 'VERIFIED' OR (reviewed_by_id IS NOT NULL AND verified_at IS NOT NULL AND char_length(scope) > 0))
);
ALTER TABLE "trust_scores" ADD CONSTRAINT trust_scores_state CHECK (
  subject_kind IN ('COMPANY', 'AGENT')
  AND ((subject_kind = 'COMPANY' AND subject_user_id IS NULL AND subject_key = 'COMPANY:' || company_id)
    OR (subject_kind = 'AGENT' AND subject_user_id IS NOT NULL AND subject_key = 'AGENT:' || subject_user_id))
  AND jsonb_typeof(checks) = 'array'
);

-- Who may see a check: the company's own people for company checks, only the agent for their own checks (not their employer),
-- and platform reviewers. The owner can submit or resubmit, but only a reviewer can mark a check as Verified.
ALTER TABLE "kyc_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kyc_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_read ON "kyc_items" FOR SELECT USING (
  (subject_kind = 'COMPANY' AND company_id = app_current_company()) OR (subject_kind = 'AGENT' AND subject_user_id = app_current_user()) OR app_platform_admin());
CREATE POLICY owner_submit ON "kyc_items" FOR INSERT WITH CHECK (
  (((subject_kind = 'COMPANY' AND company_id = app_current_company()) OR (subject_kind = 'AGENT' AND subject_user_id = app_current_user()))
    AND status = 'SUBMITTED' AND reviewed_by_id IS NULL AND verified_at IS NULL) OR app_platform_admin());
CREATE POLICY owner_resubmit ON "kyc_items" FOR UPDATE USING (
  (subject_kind = 'COMPANY' AND company_id = app_current_company()) OR (subject_kind = 'AGENT' AND subject_user_id = app_current_user()) OR app_platform_admin())
  WITH CHECK ((((subject_kind = 'COMPANY' AND company_id = app_current_company()) OR (subject_kind = 'AGENT' AND subject_user_id = app_current_user()))
    AND status = 'SUBMITTED' AND reviewed_by_id IS NULL AND verified_at IS NULL) OR app_platform_admin());

ALTER TABLE "trust_scores" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trust_scores" FORCE ROW LEVEL SECURITY;
CREATE POLICY public_read ON "trust_scores" FOR SELECT USING (true);
CREATE POLICY reviewer_write ON "trust_scores" FOR ALL USING (app_platform_admin()) WITH CHECK (app_platform_admin());
