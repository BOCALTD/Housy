-- Flatmates: what kind of space, furnishing and must-have amenities (scored in the match), "verified people only", and the
-- flatmate ID check (an ID photo and a selfie, reviewed by the platform; images deleted 30 days after the decision).
ALTER TABLE "flatmate_profiles" ADD COLUMN "spaces" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "flatmate_profiles" ADD COLUMN "space_other" TEXT NOT NULL DEFAULT '';
ALTER TABLE "flatmate_profiles" ADD COLUMN "furnishing" TEXT NOT NULL DEFAULT 'ANY';
ALTER TABLE "flatmate_profiles" ADD COLUMN "amenities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "flatmate_profiles" ADD COLUMN "verified_only" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "flatmate_checks" (
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "id_type" TEXT NOT NULL,
    "doc" BYTEA,
    "doc_type" TEXT,
    "selfie" BYTEA,
    "selfie_type" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "decided_by_id" TEXT,
    CONSTRAINT "flatmate_checks_pkey" PRIMARY KEY ("user_id")
);
CREATE INDEX "flatmate_checks_status_idx" ON "flatmate_checks"("status");
ALTER TABLE "flatmate_checks" ADD CONSTRAINT "flatmate_checks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "flatmate_checks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "flatmate_checks" FORCE ROW LEVEL SECURITY;
CREATE POLICY own_check ON "flatmate_checks" FOR ALL USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
CREATE POLICY admin_check_read ON "flatmate_checks" FOR SELECT USING (app_platform_admin());
CREATE POLICY admin_check_decide ON "flatmate_checks" FOR UPDATE USING (app_platform_admin()) WITH CHECK (app_platform_admin());
-- Whether someone is verified is shown to the people they could share with (the service reads the status column only).
CREATE POLICY verified_visible ON "flatmate_checks" FOR SELECT USING (status = 'VERIFIED');
