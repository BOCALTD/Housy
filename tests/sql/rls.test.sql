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

-- 11. Phase 4 tables: correspondence, its history and physical files are isolated by company.
SELECT set_config('app.user_id', '', true);
SELECT set_config('app.company_id', 'co-a', true);
INSERT INTO departments (id, company_id, name, code) VALUES ('d-a', 'co-a', 'Legal', 'LEG');
INSERT INTO correspondence (id, company_id, ref, direction, subject, status, sender_name, recipient_name, created_by_id, updated_at)
  VALUES ('c-a', 'co-a', 'ALP/LEG/2026/0001', 'INCOMING', 'Notice of rent review', 'REGISTERED', 'Lagos State Lands Bureau', 'Alpha Estates', 'u1', now());
INSERT INTO correspondence_actions (id, company_id, correspondence_id, kind, note, actor_id) VALUES ('ca-1', 'co-a', 'c-a', 'REGISTERED', '', 'u1');
INSERT INTO physical_files (id, company_id, file_number, title) VALUES ('f-a', 'co-a', 'F-001', 'Plot 12 title deeds');
SELECT set_config('app.company_id', 'co-b', true);
SELECT pg_temp.expect((SELECT count(*) FROM correspondence) = 0, 'B cannot see A correspondence');
SELECT pg_temp.expect((SELECT count(*) FROM correspondence_actions) = 0, 'B cannot see A correspondence history');
SELECT pg_temp.expect((SELECT count(*) FROM physical_files) = 0, 'B cannot see A physical files');
SELECT pg_temp.expect((SELECT count(*) FROM departments) = 0, 'B cannot see A departments');
DO $$ BEGIN
  INSERT INTO correspondence_actions (id, company_id, correspondence_id, kind, note, actor_id) VALUES ('ca-x', 'co-a', 'c-a', 'NOTE', 'forged', 'u2');
  RAISE EXCEPTION 'FAIL: cross-company correspondence note was allowed';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: cannot add notes to another company''s correspondence';
END $$;
SELECT set_config('app.company_id', 'co-a', true);
DO $$ BEGIN
  UPDATE correspondence_actions SET note = 'tampered' WHERE id = 'ca-1';
  RAISE EXCEPTION 'FAIL: correspondence history update was allowed';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: correspondence history is append-only';
END $$;

-- 12. Phase 5a: the rent ledger is isolated by company, financial records are append-only, and the
-- database itself refuses a charge that is paid beyond what is owed.
SELECT set_config('app.company_id', 'co-a', true);
INSERT INTO leases (id, company_id, asset_id, ref, occupant_name, start_date, end_date, rent_kobo, frequency, created_by_id)
  VALUES ('l-a', 'co-a', 'as-a', 'LSE-00001', 'Corner Pharmacy', '2026-01-01', '2027-01-01', 50000000, 'QUARTERLY', 'u1');
INSERT INTO rent_charges (id, company_id, lease_id, due_date, amount_kobo) VALUES ('rc-a', 'co-a', 'l-a', '2026-01-01', 50000000);
INSERT INTO receipts (id, company_id, lease_id, no, amount_kobo, paid_on, evidence, evidence_key, recorded_by_id)
  VALUES ('r-a', 'co-a', 'l-a', 'RCT-2026-00001', 30000000, '2026-01-02', 'GTB 0001', 'gtb0001', 'u1');
INSERT INTO rent_payments (id, company_id, charge_id, receipt_id, amount_kobo, paid_on, evidence, recorded_by_id)
  VALUES ('rp-a', 'co-a', 'rc-a', 'r-a', 30000000, '2026-01-02', 'GTB 0001', 'u1');
UPDATE rent_charges SET paid_kobo = 30000000 WHERE id = 'rc-a';
INSERT INTO receipt_reconciliations (id, company_id, receipt_id, statement_ref, reconciled_by_id)
  VALUES ('rr-a', 'co-a', 'r-a', 'Statement 12 Jan line 4', 'u2');
INSERT INTO rent_adjustments (id, company_id, charge_id, kind, amount_kobo, reason, requested_by_id)
  VALUES ('ad-a', 'co-a', 'rc-a', 'LATE_FEE', 100000, 'Clause 7', 'u1');
INSERT INTO deposit_entries (id, company_id, lease_id, kind, amount_kobo, evidence, entry_date, recorded_by_id)
  VALUES ('de-a', 'co-a', 'l-a', 'RECEIVED', 25000000, 'GTB 0002', '2026-01-02', 'u1');
INSERT INTO number_counters (company_id, kind, year, last_number) VALUES ('co-a', 'RECEIPT', 2026, 1);

DO $$ BEGIN
  UPDATE rent_charges SET paid_kobo = 50000001 WHERE id = 'rc-a';
  RAISE EXCEPTION 'FAIL: overpaying a charge was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: database refuses a charge paid beyond what is owed';
END $$;
DO $$ BEGIN
  UPDATE rent_charges SET adjusted_kobo = -30000000 WHERE id = 'rc-a';
  RAISE EXCEPTION 'FAIL: an adjustment below the amount already paid was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: database refuses an adjustment below the amount already paid';
END $$;
DO $$ BEGIN
  UPDATE rent_charges SET paid_kobo = -1 WHERE id = 'rc-a';
  RAISE EXCEPTION 'FAIL: a negative paid amount was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: database refuses a negative paid amount';
END $$;
DO $$ BEGIN
  INSERT INTO receipts (id, company_id, lease_id, no, amount_kobo, paid_on, evidence, evidence_key, recorded_by_id)
    VALUES ('r-zero', 'co-a', 'l-a', 'RCT-2026-00002', 0, '2026-01-02', 'x', 'x', 'u1');
  RAISE EXCEPTION 'FAIL: a zero receipt was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: database refuses a zero-value receipt';
END $$;
DO $$ BEGIN
  INSERT INTO receipts (id, company_id, lease_id, no, amount_kobo, paid_on, evidence, evidence_key, recorded_by_id)
    VALUES ('r-dup', 'co-a', 'l-a', 'RCT-2026-00001', 1, '2026-01-02', 'y', 'y', 'u1');
  RAISE EXCEPTION 'FAIL: a duplicate receipt number was allowed';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'ok: receipt numbers are unique within a company';
END $$;

-- Financial records are append-only for the application.
DO $$ BEGIN UPDATE receipts SET amount_kobo = 1 WHERE id = 'r-a'; RAISE EXCEPTION 'FAIL: receipt update allowed';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: receipts cannot be edited'; END $$;
DO $$ BEGIN DELETE FROM receipts WHERE id = 'r-a'; RAISE EXCEPTION 'FAIL: receipt delete allowed';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: receipts cannot be deleted'; END $$;
DO $$ BEGIN UPDATE rent_payments SET amount_kobo = 1 WHERE id = 'rp-a'; RAISE EXCEPTION 'FAIL: payment update allowed';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: payment allocations cannot be edited'; END $$;
DO $$ BEGIN UPDATE receipt_reconciliations SET statement_ref = 'x' WHERE id = 'rr-a'; RAISE EXCEPTION 'FAIL: reconciliation update allowed';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: reconciliations cannot be edited'; END $$;
DO $$ BEGIN DELETE FROM receipt_reversals WHERE receipt_id = 'r-a'; RAISE EXCEPTION 'FAIL: reversal delete allowed';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: reversals cannot be deleted'; END $$;
DO $$ BEGIN UPDATE deposit_entries SET amount_kobo = 1 WHERE id = 'de-a'; RAISE EXCEPTION 'FAIL: deposit entry update allowed';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: deposit entries cannot be edited'; END $$;

-- Company B sees and changes nothing of company A's ledger.
SELECT set_config('app.company_id', 'co-b', true);
SELECT pg_temp.expect((SELECT count(*) FROM leases) = 0, 'B cannot see A leases');
SELECT pg_temp.expect((SELECT count(*) FROM rent_charges) = 0, 'B cannot see A rent charges');
SELECT pg_temp.expect((SELECT count(*) FROM receipts) = 0, 'B cannot see A receipts');
SELECT pg_temp.expect((SELECT count(*) FROM rent_payments) = 0, 'B cannot see A payment allocations');
SELECT pg_temp.expect((SELECT count(*) FROM receipt_reconciliations) = 0, 'B cannot see A reconciliations');
SELECT pg_temp.expect((SELECT count(*) FROM rent_adjustments) = 0, 'B cannot see A adjustments');
SELECT pg_temp.expect((SELECT count(*) FROM deposit_entries) = 0, 'B cannot see A deposit ledger');
SELECT pg_temp.expect((SELECT count(*) FROM number_counters) = 0, 'B cannot see A number counters');
UPDATE rent_charges SET paid_kobo = 0 WHERE id = 'rc-a';
DO $$ BEGIN
  INSERT INTO receipts (id, company_id, lease_id, no, amount_kobo, paid_on, evidence, evidence_key, recorded_by_id)
    VALUES ('r-x', 'co-a', 'l-a', 'RCT-2026-00009', 100, '2026-01-02', 'forged', 'forged', 'u2');
  RAISE EXCEPTION 'FAIL: cross-company receipt was allowed';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: cannot issue a receipt against another company''s lease';
END $$;
DO $$ BEGIN
  INSERT INTO deposit_entries (id, company_id, lease_id, kind, amount_kobo, entry_date, recorded_by_id)
    VALUES ('de-x', 'co-a', 'l-a', 'REFUND', 100, '2026-01-02', 'u2');
  RAISE EXCEPTION 'FAIL: cross-company deposit refund was allowed';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: cannot refund another company''s deposit';
END $$;
SELECT set_config('app.company_id', 'co-a', true);
SELECT pg_temp.expect((SELECT paid_kobo FROM rent_charges WHERE id = 'rc-a') = 30000000, 'A charge balance unchanged by B''s update attempt');

SELECT 'ALL RLS CHECKS PASSED' AS result;
ROLLBACK;
