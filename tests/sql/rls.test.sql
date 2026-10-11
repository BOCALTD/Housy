-- Row-level security tests. Run as the runtime role (estate_app) against a migrated, empty database:
--   psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/rls.test.sql
-- Each check raises an exception on failure. Everything runs in one transaction and is rolled back.

BEGIN;

CREATE FUNCTION pg_temp.expect(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT cond THEN RAISE EXCEPTION 'FAIL: %', label; END IF;
  RAISE NOTICE 'ok: %', label;
END $$;

-- Seed two companies, each in its own context.
SELECT set_config('app.company_id', 'co-a', true);
INSERT INTO companies (id, name, slug) VALUES ('co-a', 'Alpha Estates', 'alpha');
INSERT INTO assets (id, company_id, ref, name, asset_class, category, company_relationship, created_by_id, updated_at)
  VALUES ('as-a', 'co-a', 'AST-0001', 'Alpha duplex', 'RESIDENTIAL', 'Duplex', 'OWNER', 'u1', now());
INSERT INTO listings (id, company_id, asset_id, public_ref, title, purpose, price_kobo, city, state, status, updated_at)
  VALUES ('li-a', 'co-a', 'as-a', 'PROP-AAAAAA', 'Alpha duplex', 'SALE', 100, 'Lekki', 'Lagos', 'PUBLISHED', now());

SELECT set_config('app.company_id', 'co-b', true);
INSERT INTO companies (id, name, slug) VALUES ('co-b', 'Beta Homes', 'beta');
INSERT INTO assets (id, company_id, ref, name, asset_class, category, company_relationship, created_by_id, updated_at)
  VALUES ('as-b', 'co-b', 'AST-0001', 'Beta warehouse', 'INDUSTRIAL', 'Warehouse', 'MANAGER', 'u2', now());
INSERT INTO listings (id, company_id, asset_id, public_ref, title, purpose, price_kobo, city, state, status, updated_at)
  VALUES ('li-b', 'co-b', 'as-b', 'PROP-BBBBBB', 'Beta warehouse', 'LEASE', 200, 'Ikeja', 'Lagos', 'DRAFT', now());

-- 1. Company B sees only its own assets and company row.
SELECT pg_temp.expect((SELECT count(*) FROM assets) = 1, 'B sees one asset');
SELECT pg_temp.expect((SELECT id FROM assets) = 'as-b', 'B sees only its asset');
SELECT pg_temp.expect((SELECT count(*) FROM companies) = 1, 'B sees only its company');

-- 2. Company B cannot read A's asset by id, update it, or delete it.
SELECT pg_temp.expect(NOT EXISTS (SELECT 1 FROM assets WHERE id = 'as-a'), 'B cannot read A asset by id');
UPDATE assets SET name = 'hijacked' WHERE id = 'as-a';
DELETE FROM assets WHERE id = 'as-a';

-- 3. Company B cannot insert a row claiming to belong to A.
DO $$ BEGIN
  INSERT INTO tasks (id, company_id, asset_id, kind, title, created_by_id, updated_at)
    VALUES ('t-x', 'co-a', 'as-a', 'TASK', 'injected', 'u2', now());
  RAISE EXCEPTION 'FAIL: cross-company insert was allowed';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: cross-company insert rejected';
END $$;

-- 4. B sees A's published listing through the public policy, but not A's private records.
SELECT pg_temp.expect((SELECT count(*) FROM listings WHERE id = 'li-a') = 1, 'published listing is public');

-- 5. With no company context, nothing private is visible; only published listings.
SELECT set_config('app.company_id', '', true);
SELECT pg_temp.expect((SELECT count(*) FROM assets) = 0, 'no context sees no assets');
SELECT pg_temp.expect((SELECT count(*) FROM listings) = 1, 'no context sees only published listings');
SELECT pg_temp.expect((SELECT count(*) FROM companies) = 0, 'no context sees no companies');

-- 6. Back in A: A's asset is untouched by B's update/delete attempts.
SELECT set_config('app.company_id', 'co-a', true);
SELECT pg_temp.expect((SELECT name FROM assets WHERE id = 'as-a') = 'Alpha duplex', 'A asset unchanged');

-- 7. Platform admin can read B's draft listing for review, but still no private assets.
SELECT set_config('app.company_id', '', true);
SELECT set_config('app.platform_admin', 'on', true);
SELECT pg_temp.expect((SELECT count(*) FROM listings) = 2, 'platform admin sees listings for review');
SELECT pg_temp.expect((SELECT count(*) FROM assets) = 0, 'platform admin does not see assets');
SELECT set_config('app.platform_admin', '', true);

-- 8. Audit log is append-only for the runtime role.
SELECT set_config('app.company_id', 'co-a', true);
INSERT INTO activity_log (id, company_id, entity_type, entity_id, action) VALUES ('log-1', 'co-a', 'asset', 'as-a', 'created');
DO $$ BEGIN
  UPDATE activity_log SET action = 'tampered' WHERE id = 'log-1';
  RAISE EXCEPTION 'FAIL: audit log update was allowed';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: audit log is append-only';
END $$;

-- 9. Public enquiry policy: allowed on a published listing, rejected on a draft.
SELECT set_config('app.company_id', '', true);
INSERT INTO enquiries (id, company_id, listing_id, name, contact, message) VALUES ('e-1', 'co-a', 'li-a', 'Ada', '0803', 'Hi');
DO $$ BEGIN
  INSERT INTO enquiries (id, company_id, listing_id, name, contact, message) VALUES ('e-2', 'co-b', 'li-b', 'Ada', '0803', 'Hi');
  RAISE EXCEPTION 'FAIL: enquiry on unpublished listing was allowed';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: enquiry on draft listing rejected';
END $$;

-- 10. A user can list their own memberships and those companies' names, and nothing else.
SELECT set_config('app.company_id', 'co-a', true);
INSERT INTO users (id, email, name, password_hash) VALUES ('user-1', 'u1@example.test', 'User One', 'x');
INSERT INTO memberships (id, company_id, user_id, role) VALUES ('m-1', 'co-a', 'user-1', 'MANAGER');
SELECT set_config('app.company_id', '', true);
SELECT set_config('app.user_id', 'user-1', true);
SELECT pg_temp.expect((SELECT count(*) FROM memberships) = 1, 'user sees own membership');
SELECT pg_temp.expect((SELECT string_agg(name, ',') FROM companies) = 'Alpha Estates', 'user sees only member company names');
SELECT pg_temp.expect((SELECT count(*) FROM assets) = 0, 'membership context does not expose assets');
SELECT set_config('app.user_id', 'user-2', true);
SELECT pg_temp.expect((SELECT count(*) FROM memberships) = 0, 'other user sees no memberships');

SELECT 'ALL RLS CHECKS PASSED' AS result;
ROLLBACK;
