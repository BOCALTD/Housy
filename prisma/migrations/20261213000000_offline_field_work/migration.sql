-- Offline field work (master prompt §49): a revision on each inspection for merging records made offline, and the list of
-- things devices have already sent, so a resend is applied once.
ALTER TABLE "inspections" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "field_syncs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_syncs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "field_syncs_company_id_user_id_client_id_key" ON "field_syncs"("company_id", "user_id", "client_id");

ALTER TABLE "field_syncs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "field_syncs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "field_syncs" FOR ALL USING (company_id = app_current_company() AND user_id = app_current_user()) WITH CHECK (company_id = app_current_company() AND user_id = app_current_user());
