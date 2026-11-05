-- Client files: which properties belong in each client's file, and read-only links a client can open to follow their property.
CREATE TABLE "client_assets" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'OWNER',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "client_assets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "client_assets_client_id_asset_id_key" ON "client_assets"("client_id", "asset_id");
CREATE INDEX "client_assets_company_id_asset_id_idx" ON "client_assets"("company_id", "asset_id");
ALTER TABLE "client_assets" ADD CONSTRAINT "client_assets_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_assets" ADD CONSTRAINT "client_assets_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "client_view_links" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "sections" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "views" INTEGER NOT NULL DEFAULT 0,
    "last_viewed_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "client_view_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "client_view_links_token_hash_key" ON "client_view_links"("token_hash");
CREATE INDEX "client_view_links_company_id_client_id_idx" ON "client_view_links"("company_id", "client_id");
ALTER TABLE "client_view_links" ADD CONSTRAINT "client_view_links_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_view_links" ADD CONSTRAINT "client_view_links_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['client_assets', 'client_view_links']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL USING (company_id = app_current_company()) WITH CHECK (company_id = app_current_company())', t);
  END LOOP;
END $$;
-- Someone holding a link can read that one link (to find out what it shows), and record that they opened it.
CREATE POLICY by_token ON "client_view_links" FOR SELECT USING (token_hash = app_invite_token());
CREATE POLICY by_token_seen ON "client_view_links" FOR UPDATE USING (token_hash = app_invite_token()) WITH CHECK (token_hash = app_invite_token());
