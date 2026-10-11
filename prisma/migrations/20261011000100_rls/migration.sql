-- Row-level security: second line of defence for tenant isolation (master prompt Section 3.3).
-- The application always filters by company. These policies make PostgreSQL refuse
-- cross-company rows even if an application query forgets to.
--
-- The application connects as the non-owner role "estate_app" (see README). Table owners
-- are also bound because every protected table uses FORCE ROW LEVEL SECURITY.
-- Context is set per transaction with set_config(..., true) in src/lib/db.ts.

CREATE OR REPLACE FUNCTION app_current_company() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.company_id', true), '') $$;

CREATE OR REPLACE FUNCTION app_current_user() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$;

CREATE OR REPLACE FUNCTION app_invite_token() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.invite_token_hash', true), '') $$;

CREATE OR REPLACE FUNCTION app_platform_admin() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('app.platform_admin', true), '') = 'on' $$;

-- Standard tenant policy on every company-owned table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['memberships','invitations','assets','asset_parties','asset_documents',
                           'leases','rent_charges','rent_payments','tasks','listings','enquiries','activity_log']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL
                      USING (company_id = app_current_company())
                      WITH CHECK (company_id = app_current_company())', t);
  END LOOP;
END $$;

-- Companies: a company sees only itself. Platform admins can read names for review queues.
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON companies FOR ALL
  USING (id = app_current_company()) WITH CHECK (id = app_current_company());
CREATE POLICY platform_admin_read ON companies FOR SELECT USING (app_platform_admin());
-- A signed-in user can read the names of companies they belong to (company switcher).
CREATE POLICY member_read ON companies FOR SELECT USING (
  id IN (SELECT m.company_id FROM memberships m WHERE m.user_id = app_current_user() AND m.status = 'ACTIVE')
);

-- Memberships: a signed-in user can list their own memberships across companies (company switcher).
CREATE POLICY own_memberships ON memberships FOR SELECT USING (user_id = app_current_user());

-- Invitations: readable by whoever presents the matching token (acceptance flow).
CREATE POLICY by_token ON invitations FOR SELECT USING (token_hash = app_invite_token());

-- Listings: anyone may read published listings. Platform admins review submissions.
CREATE POLICY public_read ON listings FOR SELECT USING (status = 'PUBLISHED');
CREATE POLICY platform_admin_read ON listings FOR SELECT USING (app_platform_admin());
CREATE POLICY platform_admin_review ON listings FOR UPDATE
  USING (app_platform_admin()) WITH CHECK (app_platform_admin());

-- Enquiries: the public can create an enquiry only against a published listing of the same company.
CREATE POLICY public_insert ON enquiries FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM listings l
          WHERE l.id = listing_id AND l.company_id = enquiries.company_id AND l.status = 'PUBLISHED')
);

-- Activity log: platform-level events (no company) and platform admin actions can be written.
CREATE POLICY platform_events_insert ON activity_log FOR INSERT
  WITH CHECK (company_id IS NULL OR app_platform_admin());
CREATE POLICY platform_admin_read ON activity_log FOR SELECT USING (app_platform_admin());

-- Runtime role privileges. Created by the database administrator before migrating (README).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'estate_app') THEN
    GRANT USAGE ON SCHEMA public TO estate_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO estate_app;
    -- The audit trail and payment records are append-only.
    REVOKE UPDATE, DELETE ON activity_log FROM estate_app;
    REVOKE UPDATE, DELETE ON rent_payments FROM estate_app;
    GRANT EXECUTE ON FUNCTION app_current_company(), app_current_user(), app_invite_token(),
                              app_platform_admin() TO estate_app;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = '_prisma_migrations') THEN
      REVOKE ALL ON _prisma_migrations FROM estate_app;
    END IF;
  END IF;
END $$;
