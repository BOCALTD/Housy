-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_token_hash_key" ON "api_keys"("token_hash");

-- CreateIndex
CREATE INDEX "api_keys_company_id_idx" ON "api_keys"("company_id");

ALTER TABLE "api_keys" ADD CONSTRAINT api_keys_state CHECK (
  char_length(name) BETWEEN 1 AND 80
  AND prefix ~ '^[A-Za-z0-9]{8}$'
  AND char_length(token_hash) = 64
  AND scopes ~ '^(assets:read)(,(assets:read))*$'
);

-- The program presenting a key has no company yet, so the key is found by the hash it presents (the same way invitations are found).
CREATE OR REPLACE FUNCTION app_api_token() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.api_token_hash', true), '') $$;
GRANT EXECUTE ON FUNCTION app_api_token() TO PUBLIC;

ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "api_keys" FOR ALL USING (company_id = app_current_company()) WITH CHECK (company_id = app_current_company());
CREATE POLICY by_token ON "api_keys" FOR SELECT USING (token_hash = app_api_token());
CREATE POLICY platform_admin_read ON "api_keys" FOR SELECT USING (app_platform_admin());
