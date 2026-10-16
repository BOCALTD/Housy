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

-- 13. Phase 5b: lifecycle records are isolated, handover and notices cannot be edited, a lease renews once.
SELECT set_config('app.company_id', 'co-a', true);
INSERT INTO lease_handovers (id, company_id, lease_id, kind, handover_on, keys_count, condition_notes, acknowledged_by, recorded_by_id)
  VALUES ('h-1', 'co-a', 'l-a', 'MOVE_IN', '2026-01-02', 2, 'Good order', 'Tenant rep', 'u2');
INSERT INTO lease_notices (id, company_id, lease_id, given_by, given_on, effective_on, reason, recorded_by_id)
  VALUES ('n-1', 'co-a', 'l-a', 'TENANT', '2026-01-02', '2026-04-02', 'Relocating', 'u2');
DO $$ BEGIN
  INSERT INTO lease_handovers (id, company_id, lease_id, kind, handover_on, keys_count, condition_notes, acknowledged_by, recorded_by_id)
    VALUES ('h-2', 'co-a', 'l-a', 'MOVE_IN', '2026-01-03', 2, 'Again', 'Tenant rep', 'u2');
  RAISE EXCEPTION 'FAIL: second move-in handover was allowed';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'ok: one move-in handover per lease'; END $$;
DO $$ BEGIN
  INSERT INTO lease_notices (id, company_id, lease_id, given_by, given_on, effective_on, reason, recorded_by_id)
    VALUES ('n-2', 'co-a', 'l-a', 'TENANT', '2026-02-02', '2026-01-02', 'Backwards', 'u2');
  RAISE EXCEPTION 'FAIL: notice effective before it was given was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: notice dates must be in order'; END $$;
DO $$ BEGIN
  UPDATE lease_handovers SET condition_notes = 'Edited' WHERE id = 'h-1';
  RAISE EXCEPTION 'FAIL: handover was edited';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: handovers cannot be edited'; END $$;
DO $$ BEGIN
  DELETE FROM lease_notices WHERE id = 'n-1';
  RAISE EXCEPTION 'FAIL: notice was deleted';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: notices cannot be deleted'; END $$;
SELECT set_config('app.company_id', 'co-b', true);
SELECT pg_temp.expect((SELECT count(*) FROM lease_handovers) = 0, 'B cannot see A handovers');
SELECT pg_temp.expect((SELECT count(*) FROM lease_notices) = 0, 'B cannot see A notices');
SELECT pg_temp.expect((SELECT count(*) FROM lease_renewals) = 0, 'B cannot see A renewals');
SELECT set_config('app.company_id', 'co-a', true);

-- 14. Phase 5c: service charge records are isolated, collections are append-only, shares cannot be negative.
SELECT set_config('app.company_id', 'co-a', true);
INSERT INTO service_charge_periods (id, company_id, asset_id, name, start_date, end_date, budget_kobo, method, created_by_id)
  VALUES ('sp-a', 'co-a', 'as-a', '2026', '2026-01-01', '2027-01-01', 1000000, 'EQUAL', 'u1');
INSERT INTO service_assessments (id, company_id, period_id, lease_id, amount_kobo, due_date)
  VALUES ('sa-a', 'co-a', 'sp-a', 'l-a', 1000000, '2026-02-01');
INSERT INTO service_collections (id, company_id, assessment_id, amount_kobo, paid_on, evidence, evidence_key, recorded_by_id)
  VALUES ('sc-a', 'co-a', 'sa-a', 400000, '2026-02-02', 'REF1', 'ref1', 'u1');
INSERT INTO service_expenses (id, company_id, period_id, description, amount_kobo, incurred_on, evidence, requested_by_id)
  VALUES ('se-a', 'co-a', 'sp-a', 'Generator diesel', 50000, '2026-02-03', 'INV-1', 'u1');
DO $$ BEGIN
  INSERT INTO service_collections (id, company_id, assessment_id, amount_kobo, paid_on, evidence, evidence_key, recorded_by_id)
    VALUES ('sc-z', 'co-a', 'sa-a', 0, '2026-02-02', 'REF0', 'ref0', 'u1');
  RAISE EXCEPTION 'FAIL: zero collection was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: collections must be positive'; END $$;
DO $$ BEGIN
  INSERT INTO service_assessments (id, company_id, period_id, lease_id, amount_kobo, due_date)
    VALUES ('sa-dup', 'co-a', 'sp-a', 'l-a', 5, '2026-02-01');
  RAISE EXCEPTION 'FAIL: second assessment for the same lease was allowed';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'ok: one assessment per lease per period'; END $$;
DO $$ BEGIN
  UPDATE service_collections SET amount_kobo = 1 WHERE id = 'sc-a';
  RAISE EXCEPTION 'FAIL: collection was edited';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: collections cannot be edited'; END $$;
DO $$ BEGIN
  DELETE FROM service_collections WHERE id = 'sc-a';
  RAISE EXCEPTION 'FAIL: collection was deleted';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: collections cannot be deleted'; END $$;
SELECT set_config('app.company_id', 'co-b', true);
SELECT pg_temp.expect((SELECT count(*) FROM service_charge_periods) = 0, 'B cannot see A service periods');
SELECT pg_temp.expect((SELECT count(*) FROM service_assessments) = 0, 'B cannot see A assessments');
SELECT pg_temp.expect((SELECT count(*) FROM service_collections) = 0, 'B cannot see A collections');
SELECT pg_temp.expect((SELECT count(*) FROM service_expenses) = 0, 'B cannot see A expenses');
SELECT set_config('app.company_id', 'co-a', true);

-- 15. Phase 5d: obligations are isolated, filings are append-only, settings are bounded.
SELECT set_config('app.company_id', 'co-a', true);
INSERT INTO obligations (id, company_id, asset_id, kind, title, due_date, created_by_id)
  VALUES ('ob-a', 'co-a', 'as-a', 'LAND_USE_CHARGE', 'Land use charge', '2026-03-31', 'u1');
INSERT INTO obligation_filings (id, company_id, obligation_id, completed_on, evidence, recorded_by_id)
  VALUES ('of-a', 'co-a', 'ob-a', '2026-03-01', 'Receipt 123', 'u1');
DO $$ BEGIN
  INSERT INTO obligation_filings (id, company_id, obligation_id, completed_on, evidence, recorded_by_id)
    VALUES ('of-b', 'co-a', 'ob-a', '2026-03-02', 'Receipt 124', 'u1');
  RAISE EXCEPTION 'FAIL: second filing was allowed';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'ok: one filing per obligation'; END $$;
DO $$ BEGIN
  UPDATE obligation_filings SET evidence = 'edited' WHERE id = 'of-a';
  RAISE EXCEPTION 'FAIL: filing was edited';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: filings cannot be edited'; END $$;
DO $$ BEGIN
  UPDATE companies SET reminder_lead_days = 0 WHERE id = 'co-a';
  RAISE EXCEPTION 'FAIL: zero lead days was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: reminder lead days are bounded'; END $$;
SELECT set_config('app.company_id', 'co-b', true);
SELECT pg_temp.expect((SELECT count(*) FROM obligations) = 0, 'B cannot see A obligations');
SELECT pg_temp.expect((SELECT count(*) FROM obligation_filings) = 0, 'B cannot see A filings');
SELECT set_config('app.company_id', 'co-a', true);

-- 16. Phase 6a: inspections are isolated, photographs are append-only, references are unique per company.
SELECT set_config('app.company_id', 'co-a', true);
INSERT INTO inspections (id, company_id, asset_id, ref, purpose, scheduled_for, created_by_id)
  VALUES ('in-a', 'co-a', 'as-a', 'INS-00001', 'ROUTINE', '2026-03-01', 'u1');
INSERT INTO inspection_responses (id, company_id, inspection_id, category, prompt, sort_order)
  VALUES ('ir-a', 'co-a', 'in-a', 'Roof', 'Is the roof sound?', 1);
INSERT INTO inspection_findings (id, company_id, inspection_id, title, severity, created_by_id)
  VALUES ('if-a', 'co-a', 'in-a', 'Leaking gutter', 'MEDIUM', 'u1');
INSERT INTO evidence_photos (id, company_id, subject_type, subject_id, file_name, mime_type, size_bytes, storage_key, uploaded_by_id)
  VALUES ('ep-a', 'co-a', 'inspection_finding', 'if-a', 'gutter.jpg', 'image/jpeg', 1000, 'k-a.jpg', 'u1');
DO $$ BEGIN
  INSERT INTO inspections (id, company_id, asset_id, ref, purpose, scheduled_for, created_by_id)
    VALUES ('in-dup', 'co-a', 'as-a', 'INS-00001', 'ROUTINE', '2026-03-01', 'u1');
  RAISE EXCEPTION 'FAIL: duplicate inspection reference was allowed';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'ok: inspection references are unique'; END $$;
DO $$ BEGIN
  INSERT INTO inspection_responses (id, company_id, inspection_id, category, prompt, sort_order)
    VALUES ('ir-dup', 'co-a', 'in-a', 'Roof', 'Again', 1);
  RAISE EXCEPTION 'FAIL: duplicate checklist position was allowed';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'ok: checklist positions are unique'; END $$;
DO $$ BEGIN
  UPDATE evidence_photos SET caption = 'edited' WHERE id = 'ep-a';
  RAISE EXCEPTION 'FAIL: photograph record was edited';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: photograph records cannot be edited'; END $$;
DO $$ BEGIN
  UPDATE inspection_findings SET estimated_cost_kobo = -1 WHERE id = 'if-a';
  RAISE EXCEPTION 'FAIL: negative estimate was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: estimates cannot be negative'; END $$;
SELECT set_config('app.company_id', 'co-b', true);
SELECT pg_temp.expect((SELECT count(*) FROM inspections) = 0, 'B cannot see A inspections');
SELECT pg_temp.expect((SELECT count(*) FROM inspection_responses) = 0, 'B cannot see A checklist responses');
SELECT pg_temp.expect((SELECT count(*) FROM inspection_findings) = 0, 'B cannot see A findings');
SELECT pg_temp.expect((SELECT count(*) FROM evidence_photos) = 0, 'B cannot see A photographs');
SELECT set_config('app.company_id', 'co-a', true);

-- 17. Phase 6b: work orders are isolated, their history is append-only, costs and schedules are bounded.
SELECT set_config('app.company_id', 'co-a', true);
INSERT INTO preventive_schedules (id, company_id, asset_id, title, interval_months, next_due_on, created_by_id)
  VALUES ('ps-a', 'co-a', 'as-a', 'Generator service', 6, '2026-06-01', 'u1');
INSERT INTO work_orders (id, company_id, asset_id, ref, title, requested_by_id, schedule_id, scheduled_for, updated_at)
  VALUES ('wo-a', 'co-a', 'as-a', 'WO-2026-0001', 'Service generator', 'u1', 'ps-a', '2026-06-01', now());
INSERT INTO work_order_events (id, company_id, work_order_id, kind, to_status, actor_id)
  VALUES ('we-a', 'co-a', 'wo-a', 'REPORTED', 'REPORTED', 'u1');
DO $$ BEGIN
  INSERT INTO work_orders (id, company_id, asset_id, ref, title, requested_by_id, schedule_id, scheduled_for, updated_at)
    VALUES ('wo-dup', 'co-a', 'as-a', 'WO-2026-0002', 'Service generator again', 'u1', 'ps-a', '2026-06-01', now());
  RAISE EXCEPTION 'FAIL: second work order for the same schedule date was allowed';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'ok: one work order per schedule date'; END $$;
DO $$ BEGIN
  UPDATE work_order_events SET note = 'edited' WHERE id = 'we-a';
  RAISE EXCEPTION 'FAIL: work order history was edited';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: work order history cannot be edited'; END $$;
DO $$ BEGIN
  UPDATE work_orders SET actual_cost_kobo = -5 WHERE id = 'wo-a';
  RAISE EXCEPTION 'FAIL: negative cost was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: costs cannot be negative'; END $$;
DO $$ BEGIN
  INSERT INTO work_order_materials (id, company_id, work_order_id, description, quantity, unit_cost_kobo, recorded_by_id)
    VALUES ('wm-z', 'co-a', 'wo-a', 'Filters', 0, 100, 'u1');
  RAISE EXCEPTION 'FAIL: zero quantity was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: material quantity must be positive'; END $$;
SELECT set_config('app.company_id', 'co-b', true);
SELECT pg_temp.expect((SELECT count(*) FROM work_orders) = 0, 'B cannot see A work orders');
SELECT pg_temp.expect((SELECT count(*) FROM work_order_events) = 0, 'B cannot see A work order history');
SELECT pg_temp.expect((SELECT count(*) FROM preventive_schedules) = 0, 'B cannot see A schedules');
SELECT set_config('app.company_id', 'co-a', true);

-- 18. Phase 6c: inventory is isolated, movements are append-only, balances and movement signs are bounded.
SELECT set_config('app.company_id', 'co-a', true);
INSERT INTO inventory_items (id, company_id, item_no, code, name, kind, quantity, created_by_id, updated_at)
  VALUES ('ii-a', 'co-a', 'INV-0001', 'INV-0001', 'Generator', 'MOVABLE', 3, 'u1', now());
INSERT INTO inventory_movements (id, company_id, item_id, kind, delta, balance_after, performed_by_id)
  VALUES ('im-a', 'co-a', 'ii-a', 'RECEIPT', 3, 3, 'u1');
DO $$ BEGIN
  UPDATE inventory_movements SET note = 'edited' WHERE id = 'im-a';
  RAISE EXCEPTION 'FAIL: stock movement was edited';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: stock movements cannot be edited'; END $$;
DO $$ BEGIN
  DELETE FROM inventory_movements WHERE id = 'im-a';
  RAISE EXCEPTION 'FAIL: stock movement was deleted';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: stock movements cannot be deleted'; END $$;
DO $$ BEGIN
  UPDATE inventory_items SET quantity = -1 WHERE id = 'ii-a';
  RAISE EXCEPTION 'FAIL: negative stock was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: stock cannot be negative'; END $$;
DO $$ BEGIN
  INSERT INTO inventory_movements (id, company_id, item_id, kind, delta, balance_after, performed_by_id)
    VALUES ('im-bad', 'co-a', 'ii-a', 'ISSUE', 2, 5, 'u1');
  RAISE EXCEPTION 'FAIL: an issue that adds stock was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: an issue must reduce stock'; END $$;
DO $$ BEGIN
  INSERT INTO inventory_items (id, company_id, item_no, code, name, kind, quantity, created_by_id, updated_at)
    VALUES ('ii-dup', 'co-a', 'INV-0002', 'INV-0001', 'Other', 'MOVABLE', 1, 'u1', now());
  RAISE EXCEPTION 'FAIL: duplicate code was allowed';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'ok: codes are unique per company'; END $$;
DO $$ BEGIN
  INSERT INTO inventory_adjustments (id, company_id, item_id, kind, delta, reason, status, requested_by_id)
    VALUES ('ia-bad', 'co-a', 'ii-a', 'LOSS', -1, 'Stolen', 'APPROVED', 'u1');
  RAISE EXCEPTION 'FAIL: approval without an approver was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a decided adjustment needs a decider'; END $$;
INSERT INTO handover_schedules (id, company_id, lease_id, kind, recorded_by_id) SELECT 'hs-a', 'co-a', id, 'MOVE_IN', 'u1' FROM leases WHERE company_id = 'co-a' LIMIT 1;
INSERT INTO handover_schedule_lines (id, company_id, schedule_id, room, description, quantity, condition)
  VALUES ('hl-a', 'co-a', 'hs-a', 'Lounge', 'Sofa', 1, 'GOOD');
UPDATE handover_schedules SET status = 'ACKNOWLEDGED', acknowledged_by = 'Tenant Name', acknowledged_on = '2026-01-01' WHERE id = 'hs-a';
DO $$ BEGIN
  UPDATE handover_schedule_lines SET quantity = 2 WHERE id = 'hl-a';
  RAISE EXCEPTION 'FAIL: an acknowledged schedule line was edited';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: acknowledged schedule lines are frozen'; END $$;
DO $$ BEGIN
  INSERT INTO handover_schedule_lines (id, company_id, schedule_id, room, description, quantity, condition)
    VALUES ('hl-b', 'co-a', 'hs-a', 'Lounge', 'Table', 1, 'GOOD');
  RAISE EXCEPTION 'FAIL: a line was added to an acknowledged schedule';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: no lines can be added after acknowledgement'; END $$;
DO $$ BEGIN
  UPDATE handover_schedules SET acknowledged_by = 'Someone Else' WHERE id = 'hs-a';
  RAISE EXCEPTION 'FAIL: an acknowledged schedule was changed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: acknowledged schedules are frozen'; END $$;
SELECT set_config('app.company_id', 'co-b', true);
SELECT pg_temp.expect((SELECT count(*) FROM inventory_items) = 0, 'B cannot see A inventory');
SELECT pg_temp.expect((SELECT count(*) FROM inventory_movements) = 0, 'B cannot see A stock movements');
SELECT set_config('app.company_id', 'co-a', true);

-- 19. Phase 7a: valuation records are isolated; evidence is bounded; an approved report is frozen.
INSERT INTO valuation_instructions (id, company_id, ref, asset_id, client_name, purpose, instruction_date, created_by_id, updated_at)
  SELECT 'vi-a', 'co-a', 'VAL-2026-0001', id, 'Client', 'SALE', '2026-01-01', 'u1', now() FROM assets WHERE company_id = 'co-a' LIMIT 1;
INSERT INTO valuation_comparables (id, company_id, instruction_id, address, evidence_date, price_kobo, area_sqm100, created_by_id)
  VALUES ('vc-a', 'co-a', 'vi-a', '1 Test Street', '2026-01-01', 5000000000, 20000, 'u1');
DO $$ BEGIN
  INSERT INTO valuation_comparables (id, company_id, instruction_id, address, evidence_date, price_kobo, area_sqm100, adjustment_bps, created_by_id)
    VALUES ('vc-bad', 'co-a', 'vi-a', 'x', '2026-01-01', 1, 1, 6000, 'u1');
  RAISE EXCEPTION 'FAIL: a 60 percent adjustment was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: adjustments are bounded'; END $$;
DO $$ BEGIN
  INSERT INTO valuation_comparables (id, company_id, instruction_id, address, evidence_date, price_kobo, area_sqm100, created_by_id)
    VALUES ('vc-bad2', 'co-a', 'vi-a', 'x', '2026-01-01', 0, 1, 'u1');
  RAISE EXCEPTION 'FAIL: a zero price was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: comparables need a price'; END $$;
DO $$ BEGIN
  INSERT INTO valuation_reports (id, company_id, instruction_id, version, status, author_id, decided_by_id, updated_at)
    VALUES ('vr-bad', 'co-a', 'vi-a', 9, 'APPROVED', 'u1', 'u1', now());
  RAISE EXCEPTION 'FAIL: self-approval of a report was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: the author cannot approve their own report'; END $$;
INSERT INTO valuation_reports (id, company_id, instruction_id, version, status, concluded_value_kobo, author_id, decided_by_id, updated_at)
  VALUES ('vr-a', 'co-a', 'vi-a', 1, 'APPROVED', 100, 'u1', 'u2', now());
DO $$ BEGIN
  UPDATE valuation_reports SET concluded_value_kobo = 999 WHERE id = 'vr-a';
  RAISE EXCEPTION 'FAIL: an approved report was edited';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: approved reports are frozen'; END $$;
DO $$ BEGIN
  DELETE FROM valuation_reports WHERE id = 'vr-a';
  RAISE EXCEPTION 'FAIL: an approved report was deleted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: approved reports cannot be deleted'; END $$;
UPDATE valuation_reports SET status = 'SUPERSEDED', superseded_at = now() WHERE id = 'vr-a';
SELECT pg_temp.expect((SELECT status FROM valuation_reports WHERE id = 'vr-a') = 'SUPERSEDED', 'an approved report can be superseded');
DO $$ BEGIN
  UPDATE valuation_reports SET summary = 'changed' WHERE id = 'vr-a';
  RAISE EXCEPTION 'FAIL: a superseded report was edited';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: superseded reports are frozen'; END $$;
SELECT set_config('app.company_id', 'co-b', true);
SELECT pg_temp.expect((SELECT count(*) FROM valuation_instructions) = 0, 'B cannot see A valuations');
SELECT pg_temp.expect((SELECT count(*) FROM valuation_comparables) = 0, 'B cannot see A comparables');
SELECT pg_temp.expect((SELECT count(*) FROM valuation_reports) = 0, 'B cannot see A reports');
SELECT set_config('app.company_id', 'co-a', true);

-- 20. Phase 7b: projects are isolated; money and progress are bounded; decisions need a second person; forecasts are append-only.
INSERT INTO projects (id, company_id, ref, asset_id, title, kind, planned_start, planned_end, created_by_id, updated_at)
  SELECT 'pj-a', 'co-a', 'PRJ-2026-0001', id, 'Roof', 'RENOVATION', '2026-01-01', '2026-06-01', 'u1', now() FROM assets WHERE company_id = 'co-a' LIMIT 1;
INSERT INTO work_packages (id, company_id, project_id, code, title, planned_start, planned_end, updated_at)
  VALUES ('wp-a', 'co-a', 'pj-a', 'WP-1', 'Strip roof', '2026-01-01', '2026-02-01', now());
INSERT INTO commitments (id, company_id, project_id, work_package_id, ref, supplier_name, description, amount_kobo, requested_by_id)
  VALUES ('cm-a', 'co-a', 'pj-a', 'wp-a', 'CMT-2026-0001', 'Builder', 'Roofing', 100000, 'u1');
DO $$ BEGIN
  INSERT INTO projects (id, company_id, ref, asset_id, title, kind, planned_start, planned_end, created_by_id, updated_at)
    SELECT 'pj-bad', 'co-a', 'PRJ-X', id, 'Bad', 'RENOVATION', '2026-06-01', '2026-01-01', 'u1', now() FROM assets WHERE company_id = 'co-a' LIMIT 1;
  RAISE EXCEPTION 'FAIL: a project ending before it starts was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: project dates are ordered'; END $$;
DO $$ BEGIN
  UPDATE projects SET budget_status = 'APPROVED' WHERE id = 'pj-a';
  RAISE EXCEPTION 'FAIL: an approved budget without a figure was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: an approved budget has a figure'; END $$;
DO $$ BEGIN
  UPDATE projects SET budget_submitted_by_id = 'u1', budget_decided_by_id = 'u1' WHERE id = 'pj-a';
  RAISE EXCEPTION 'FAIL: budget self-approval was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: the budget needs a second person'; END $$;
DO $$ BEGIN
  UPDATE work_packages SET percent_complete = 120 WHERE id = 'wp-a';
  RAISE EXCEPTION 'FAIL: 120 percent complete was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: progress is 0 to 100'; END $$;
DO $$ BEGIN
  UPDATE work_packages SET status = 'DONE' WHERE id = 'wp-a';
  RAISE EXCEPTION 'FAIL: a done work package under 100 percent was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: done means 100 percent'; END $$;
DO $$ BEGIN
  INSERT INTO commitments (id, company_id, project_id, ref, supplier_name, description, amount_kobo, requested_by_id)
    VALUES ('cm-bad', 'co-a', 'pj-a', 'CMT-X', 'S', 'D', 0, 'u1');
  RAISE EXCEPTION 'FAIL: a zero commitment was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: commitments are positive'; END $$;
DO $$ BEGIN
  UPDATE commitments SET status = 'APPROVED', decided_by_id = 'u1' WHERE id = 'cm-a';
  RAISE EXCEPTION 'FAIL: self-approved commitment was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a commitment needs a second person'; END $$;
DO $$ BEGIN
  UPDATE commitments SET status = 'APPROVED' WHERE id = 'cm-a';
  RAISE EXCEPTION 'FAIL: a decision without a decider was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a decided commitment names its decider'; END $$;
DO $$ BEGIN
  INSERT INTO project_invoices (id, company_id, project_id, commitment_id, invoice_no, invoice_date, amount_kobo, status, recorded_by_id)
    VALUES ('pi-bad', 'co-a', 'pj-a', 'cm-a', 'I-1', '2026-02-01', 100, 'PAID', 'u1');
  RAISE EXCEPTION 'FAIL: a paid invoice without payment details was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a paid invoice records who paid and when'; END $$;
DO $$ BEGIN
  INSERT INTO variations (id, company_id, project_id, ref, target, title, reason, amount_kobo, requested_by_id)
    VALUES ('vr-bad1', 'co-a', 'pj-a', 'VAR-X', 'COMMITMENT', 'T', 'R', 100, 'u1');
  RAISE EXCEPTION 'FAIL: a commitment variation without a commitment was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a commitment variation names its commitment'; END $$;
DO $$ BEGIN
  INSERT INTO variations (id, company_id, project_id, ref, target, commitment_id, title, reason, amount_kobo, requested_by_id)
    VALUES ('vr-bad2', 'co-a', 'pj-a', 'VAR-Y', 'BUDGET', 'cm-a', 'T', 'R', 100, 'u1');
  RAISE EXCEPTION 'FAIL: a budget variation naming a commitment was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a budget variation has no commitment'; END $$;
DO $$ BEGIN
  INSERT INTO variations (id, company_id, project_id, ref, target, title, reason, amount_kobo, requested_by_id)
    VALUES ('vr-bad3', 'co-a', 'pj-a', 'VAR-Z', 'BUDGET', 'T', 'R', 0, 'u1');
  RAISE EXCEPTION 'FAIL: a zero variation was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a variation changes something'; END $$;
INSERT INTO project_forecasts (id, company_id, project_id, work_package_id, etc_kobo, recorded_by_id) VALUES ('pf-a', 'co-a', 'pj-a', 'wp-a', 5000, 'u1');
SELECT set_config('app.company_id', 'co-b', true);
SELECT pg_temp.expect((SELECT count(*) FROM projects) = 0, 'B cannot see A projects');
SELECT pg_temp.expect((SELECT count(*) FROM commitments) = 0, 'B cannot see A commitments');
SELECT pg_temp.expect((SELECT count(*) FROM project_forecasts) = 0, 'B cannot see A forecasts');
SELECT set_config('app.company_id', 'co-a', true);

-- 21. Phase 7c-1: delivery records are isolated and bounded; procurement, risk and quality rules hold in the database.
INSERT INTO procurement_items (id, company_id, project_id, description, quantity, required_by, created_by_id, updated_at)
  VALUES ('pr-a', 'co-a', 'pj-a', 'Cement', 10, '2026-03-01', 'u1', now());
DO $$ BEGIN
  INSERT INTO procurement_items (id, company_id, project_id, description, quantity, required_by, created_by_id, updated_at)
    VALUES ('pr-bad', 'co-a', 'pj-a', 'None', 0, '2026-03-01', 'u1', now());
  RAISE EXCEPTION 'FAIL: a zero quantity was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: procurement quantities are positive'; END $$;
DO $$ BEGIN
  UPDATE procurement_items SET status = 'ORDERED' WHERE id = 'pr-a';
  RAISE EXCEPTION 'FAIL: an order without a supplier was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: an order names its supplier'; END $$;
DO $$ BEGIN
  UPDATE procurement_items SET status = 'DELIVERED', supplier_name = 'S', delivered_on = '2026-03-01', delivered_qty = 5 WHERE id = 'pr-a';
  RAISE EXCEPTION 'FAIL: a part delivery marked delivered was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: delivered means fully delivered'; END $$;
INSERT INTO project_risks (id, company_id, project_id, ref, title, likelihood, impact, created_by_id, updated_at)
  VALUES ('rk-a', 'co-a', 'pj-a', 'RSK-1', 'Rain', 3, 4, 'u1', now());
DO $$ BEGIN
  INSERT INTO project_risks (id, company_id, project_id, ref, title, likelihood, impact, created_by_id, updated_at)
    VALUES ('rk-bad', 'co-a', 'pj-a', 'RSK-2', 'Bad', 6, 1, 'u1', now());
  RAISE EXCEPTION 'FAIL: likelihood 6 was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: risk scores are 1 to 5'; END $$;
DO $$ BEGIN
  UPDATE project_risks SET status = 'CLOSED' WHERE id = 'rk-a';
  RAISE EXCEPTION 'FAIL: a risk closed without a note was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: closing a risk needs a note'; END $$;
INSERT INTO quality_checks (id, company_id, project_id, work_package_id, title, created_by_id, updated_at)
  VALUES ('qc-a', 'co-a', 'pj-a', 'wp-a', 'Waterproofing', 'u1', now());
DO $$ BEGIN
  UPDATE quality_checks SET result = 'PASSED' WHERE id = 'qc-a';
  RAISE EXCEPTION 'FAIL: a passed check without a checker was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a decided check names its checker'; END $$;
DO $$ BEGIN
  UPDATE quality_checks SET result = 'WAIVED', checked_by_id = 'u2', checked_on = '2026-03-01' WHERE id = 'qc-a';
  RAISE EXCEPTION 'FAIL: a waiver without a reason was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a waiver needs a reason'; END $$;
INSERT INTO progress_updates (id, company_id, project_id, report_date, summary, percent_complete, recorded_by_id) VALUES ('pu-a', 'co-a', 'pj-a', '2026-03-01', 'On track', 40, 'u1');
DO $$ BEGIN
  INSERT INTO progress_updates (id, company_id, project_id, report_date, summary, percent_complete, recorded_by_id) VALUES ('pu-bad', 'co-a', 'pj-a', '2026-03-01', 'x', 140, 'u1');
  RAISE EXCEPTION 'FAIL: 140 percent was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: progress is 0 to 100'; END $$;
SELECT set_config('app.company_id', 'co-b', true);
SELECT pg_temp.expect((SELECT count(*) FROM procurement_items) = 0, 'B cannot see A procurement');
SELECT pg_temp.expect((SELECT count(*) FROM project_risks) = 0, 'B cannot see A risks');
SELECT pg_temp.expect((SELECT count(*) FROM quality_checks) = 0, 'B cannot see A quality checks');
SELECT pg_temp.expect((SELECT count(*) FROM progress_updates) = 0, 'B cannot see A progress updates');
SELECT set_config('app.company_id', 'co-a', true);

-- 22. Phase 7c-2: completion, defects, warranties, documents and handover rules hold in the database.
DO $$ BEGIN
  UPDATE projects SET status = 'COMPLETED' WHERE id = 'pj-a';
  RAISE EXCEPTION 'FAIL: completion without an approver was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: completion names its approver'; END $$;
DO $$ BEGIN
  UPDATE projects SET completion_requested_by_id = 'u1', completed_by_id = 'u1' WHERE id = 'pj-a';
  RAISE EXCEPTION 'FAIL: self-approved completion was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: completion is approved by a second person'; END $$;
DO $$ BEGIN
  UPDATE projects SET defects_months = 61 WHERE id = 'pj-a';
  RAISE EXCEPTION 'FAIL: a 61 month defects period was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: defects period is 0 to 60 months'; END $$;
DO $$ BEGIN
  UPDATE projects SET handover_on = '2026-03-01', handover_by_id = 'u1', handed_to_name = 'Owner' WHERE id = 'pj-a';
  RAISE EXCEPTION 'FAIL: a handover before completion was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: handover follows completion'; END $$;
INSERT INTO project_defects (id, company_id, project_id, ref, title, severity, raised_by_id, raised_on, updated_at)
  VALUES ('df-a', 'co-a', 'pj-a', 'DEF-1', 'Cracked tile', 'LOW', 'u1', '2026-03-01', now());
DO $$ BEGIN
  UPDATE project_defects SET status = 'FIXED' WHERE id = 'df-a';
  RAISE EXCEPTION 'FAIL: a fix without a fixer was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a fix names the fixer'; END $$;
DO $$ BEGIN
  UPDATE project_defects SET status = 'VERIFIED', fixed_by_id = 'u2', fixed_on = '2026-03-02', verified_by_id = 'u2', verified_on = '2026-03-03' WHERE id = 'df-a';
  RAISE EXCEPTION 'FAIL: a self-verified fix was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a fix is verified by someone else'; END $$;
DO $$ BEGIN
  INSERT INTO project_warranties (id, company_id, project_id, asset_id, title, provider, starts_on, ends_on, created_by_id)
    SELECT 'wr-bad', 'co-a', 'pj-a', asset_id, 'Roof', 'Roofers', '2026-03-01', '2026-02-01', 'u1' FROM projects WHERE id = 'pj-a';
  RAISE EXCEPTION 'FAIL: a warranty ending before it starts was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: warranty dates run forward'; END $$;
INSERT INTO project_documents (id, company_id, project_id, kind, title, file_name, mime_type, size_bytes, storage_key, uploaded_by_id)
  VALUES ('pd-a', 'co-a', 'pj-a', 'DRAWING', 'Plan', 'plan.pdf', 'application/pdf', 10, 'sk-pd-a', 'u1');
INSERT INTO handover_items (id, company_id, project_id, title, updated_at) VALUES ('hi-a', 'co-a', 'pj-a', 'Keys handed over', now());
DO $$ BEGIN
  UPDATE handover_items SET done = true WHERE id = 'hi-a';
  RAISE EXCEPTION 'FAIL: a ticked item without a name was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a ticked handover item names who ticked it'; END $$;
SELECT set_config('app.company_id', 'co-b', true);
SELECT pg_temp.expect((SELECT count(*) FROM project_defects) = 0, 'B cannot see A defects');
SELECT pg_temp.expect((SELECT count(*) FROM project_documents) = 0, 'B cannot see A project documents');
SELECT pg_temp.expect((SELECT count(*) FROM handover_items) = 0, 'B cannot see A handover items');
SELECT set_config('app.company_id', 'co-a', true);

-- 23. Phase 8a: CRM records are isolated, and lead and activity rules hold in the database.
INSERT INTO clients (id, company_id, ref, name, owner_id, created_by_id, updated_at) VALUES ('cl-a', 'co-a', 'CLT-2026-0001', 'Ada Obi', 'u1', 'u1', now());
DO $$ BEGIN
  INSERT INTO clients (id, company_id, ref, name, owner_id, created_by_id, updated_at) VALUES ('cl-bad', 'co-a', 'CLT-2026-0002', ' ', 'u1', 'u1', now());
  RAISE EXCEPTION 'FAIL: a blank client name was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a client has a name'; END $$;
INSERT INTO leads (id, company_id, ref, client_id, title, owner_id, created_by_id, updated_at) VALUES ('ld-a', 'co-a', 'LD-2026-0001', 'cl-a', 'Wants a flat', 'u1', 'u1', now());
DO $$ BEGIN
  UPDATE leads SET status = 'QUALIFIED' WHERE id = 'ld-a';
  RAISE EXCEPTION 'FAIL: a qualified lead without a budget was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: qualified leads have a budget, timeline and qualifier'; END $$;
DO $$ BEGIN
  UPDATE leads SET status = 'LOST' WHERE id = 'ld-a';
  RAISE EXCEPTION 'FAIL: a lost lead without a reason was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a lost lead has a reason'; END $$;
DO $$ BEGIN
  INSERT INTO client_activities (id, company_id, client_id, kind, subject, created_by_id) VALUES ('ca-bad', 'co-a', 'cl-a', 'FOLLOW_UP', 'Call back', 'u1');
  RAISE EXCEPTION 'FAIL: a follow-up without a due date was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: follow-ups have a due date'; END $$;
DO $$ BEGIN
  INSERT INTO property_requirements (id, company_id, client_id, purpose, budget_max_kobo, budget_min_kobo, created_by_id, updated_at) VALUES ('rq-bad', 'co-a', 'cl-a', 'RENT', 100, 200, 'u1', now());
  RAISE EXCEPTION 'FAIL: a minimum above the maximum budget was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: budget range runs upward'; END $$;
DO $$ BEGIN
  INSERT INTO client_not_duplicates (id, company_id, client_a_id, client_b_id, decided_by_id) VALUES ('nd-bad', 'co-a', 'z', 'a', 'u1');
  RAISE EXCEPTION 'FAIL: an unordered pair was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: not-duplicate pairs are stored in order'; END $$;
SELECT set_config('app.company_id', 'co-b', true);
SELECT pg_temp.expect((SELECT count(*) FROM clients) = 0, 'B cannot see A clients');
SELECT pg_temp.expect((SELECT count(*) FROM leads) = 0, 'B cannot see A leads');
SELECT set_config('app.company_id', 'co-a', true);

-- 24. Phase 8b: deals, viewings and offers are isolated, and their rules hold in the database.
INSERT INTO deals (id, company_id, ref, type, title, client_id, asset_id, owner_id, asking_kobo, created_by_id, updated_at) VALUES ('dl-a', 'co-a', 'DL-2026-0001', 'SALE', 'Sale of the flat', 'cl-a', 'as-a', 'u1', 5000000, 'u1', now());
DO $$ BEGIN
  UPDATE deals SET stage = 'AGREED' WHERE id = 'dl-a';
  RAISE EXCEPTION 'FAIL: an agreed deal without an agreed price was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: an agreed deal has an agreed price'; END $$;
DO $$ BEGIN
  UPDATE deals SET status = 'COMPLETED' WHERE id = 'dl-a';
  RAISE EXCEPTION 'FAIL: a completed status at the wrong stage was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: completion matches the stage'; END $$;
DO $$ BEGIN
  UPDATE deals SET status = 'CANCELLED' WHERE id = 'dl-a';
  RAISE EXCEPTION 'FAIL: a cancelled deal without a reason was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a cancelled deal says why'; END $$;
DO $$ BEGIN
  UPDATE deals SET status = 'DISPUTED' WHERE id = 'dl-a';
  RAISE EXCEPTION 'FAIL: a disputed deal without a reason was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a dispute says why'; END $$;
DO $$ BEGIN
  INSERT INTO viewings (id, company_id, deal_id, asset_id, agent_id, starts_at, ends_at, created_by_id, updated_at) VALUES ('vw-bad', 'co-a', 'dl-a', 'as-a', 'm1', now(), now(), 'u1', now());
  RAISE EXCEPTION 'FAIL: a viewing that ends when it starts was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a viewing has a length'; END $$;
INSERT INTO offers (id, company_id, deal_id, side, amount_kobo, recorded_by_id, updated_at) VALUES ('of-a', 'co-a', 'dl-a', 'CLIENT', 4500000, 'u1', now());
DO $$ BEGIN
  UPDATE offers SET status = 'ACCEPTED', decided_by_id = 'u1', accept_requested_by_id = 'u1' WHERE id = 'of-a';
  RAISE EXCEPTION 'FAIL: the same person requested and approved an acceptance';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: acceptance is approved by a second person'; END $$;
DO $$ BEGIN
  UPDATE offers SET status = 'REJECTED' WHERE id = 'of-a';
  RAISE EXCEPTION 'FAIL: a rejection without a reason was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a rejection says why'; END $$;
INSERT INTO deal_events (id, company_id, deal_id, kind, summary, actor_id) VALUES ('de-a', 'co-a', 'dl-a', 'OPENED', 'Opened', 'u1');
DO $$ BEGIN
  UPDATE deal_events SET summary = 'Changed' WHERE id = 'de-a';
  RAISE EXCEPTION 'FAIL: a deal event was edited';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: deal history is append-only'; END $$;
SELECT set_config('app.company_id', 'co-b', true);
SELECT pg_temp.expect((SELECT count(*) FROM deals) = 0, 'B cannot see A deals');
SELECT pg_temp.expect((SELECT count(*) FROM offers) = 0, 'B cannot see A offers');
SELECT pg_temp.expect((SELECT count(*) FROM deal_events) = 0, 'B cannot see A deal history');
SELECT set_config('app.company_id', 'co-a', true);

-- 25. Phase 8c: commission rules, second-person approval and split rules hold in the database.
DO $$ BEGIN
  INSERT INTO deals (id, company_id, ref, type, title, client_id, asset_id, owner_id, asking_kobo, agreed_kobo, stage, status, completed_at, completed_by_id, created_by_id, updated_at)
    VALUES ('dl-bad', 'co-a', 'DL-2026-0090', 'SALE', 'Finished but open', 'cl-a', 'as-a', 'u1', 5000000, 5000000, 'COMPLETED', 'OPEN', now(), 'u1', 'u1', now());
  RAISE EXCEPTION 'FAIL: a completed stage with an open status was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a finished deal is completed or disputed, never open'; END $$;
INSERT INTO deals (id, company_id, ref, type, title, client_id, asset_id, owner_id, asking_kobo, agreed_kobo, stage, status, completed_at, completed_by_id, dispute_reason, disputed_by_id, created_by_id, updated_at)
  VALUES ('dl-c', 'co-a', 'DL-2026-0091', 'SALE', 'Finished sale', 'cl-a', 'as-a', 'u1', 5000000, 5000000, 'COMPLETED', 'DISPUTED', now(), 'u1', 'Title queried', 'u1', 'u1', now());
DO $$ BEGIN
  UPDATE deals SET completed_by_id = NULL WHERE id = 'dl-c';
  RAISE EXCEPTION 'FAIL: a completed deal without who completed it was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a completed deal keeps who completed it, even in dispute'; END $$;
DO $$ BEGIN
  INSERT INTO commission_rules (id, company_id, name, method, rate_bps, created_by_id) VALUES ('cr-bad', 'co-a', 'Too much', 'PERCENT', 10001, 'u1');
  RAISE EXCEPTION 'FAIL: a rate above 100 percent was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a commission rate is at most 100 percent'; END $$;
DO $$ BEGIN
  INSERT INTO commission_rules (id, company_id, name, method, rate_bps, fixed_kobo, created_by_id) VALUES ('cr-bad', 'co-a', 'Both', 'FIXED', 500, 1000, 'u1');
  RAISE EXCEPTION 'FAIL: a fixed rule with a rate was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a rule is either a percentage or a fixed amount'; END $$;
INSERT INTO commission_rules (id, company_id, name, method, rate_bps, created_by_id) VALUES ('cr-a', 'co-a', 'Sales 5%', 'PERCENT', 500, 'u1');
INSERT INTO deal_commissions (id, company_id, deal_id, rule_id, rule_name, method, rate_bps, basis_kobo, total_kobo, submitted_by_id, updated_at)
  VALUES ('dc-a', 'co-a', 'dl-c', 'cr-a', 'Sales 5%', 'PERCENT', 500, 5000000, 250000, 'u1', now());
DO $$ BEGIN
  UPDATE deal_commissions SET status = 'APPROVED', decided_by_id = 'u1' WHERE id = 'dc-a';
  RAISE EXCEPTION 'FAIL: the proposer approved their own commission';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a commission is approved by a second person'; END $$;
DO $$ BEGIN
  UPDATE deal_commissions SET status = 'REJECTED', decided_by_id = 'u2' WHERE id = 'dc-a';
  RAISE EXCEPTION 'FAIL: a rejection without a reason was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a commission rejection says why'; END $$;
DO $$ BEGIN
  UPDATE deal_commissions SET status = 'PAID', decided_by_id = 'u2' WHERE id = 'dc-a';
  RAISE EXCEPTION 'FAIL: a paid commission without a payment date was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a paid commission is dated'; END $$;
DO $$ BEGIN
  INSERT INTO commission_splits (id, company_id, commission_id, membership_id, role, share_bps, amount_kobo) VALUES ('cs-bad', 'co-a', 'dc-a', 'm1', 'SELLING_AGENT', 0, 0);
  RAISE EXCEPTION 'FAIL: an empty share was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a share is at least one basis point'; END $$;
INSERT INTO commission_splits (id, company_id, commission_id, membership_id, role, share_bps, amount_kobo) VALUES ('cs-a', 'co-a', 'dc-a', 'm1', 'SELLING_AGENT', 10000, 250000);
DO $$ BEGIN
  UPDATE commission_splits SET paid_at = now() WHERE id = 'cs-a';
  RAISE EXCEPTION 'FAIL: a payment with no payer was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a payment records who paid'; END $$;
DO $$ BEGIN
  INSERT INTO commission_splits (id, company_id, commission_id, membership_id, role, share_bps, amount_kobo) VALUES ('cs-dup', 'co-a', 'dc-a', 'm1', 'REFERRAL', 100, 1);
  RAISE EXCEPTION 'FAIL: the same person was given two shares';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'ok: a person has one share per commission'; END $$;
SELECT set_config('app.company_id', 'co-b', true);
SELECT pg_temp.expect((SELECT count(*) FROM commission_rules) = 0, 'B cannot see A commission rules');
SELECT pg_temp.expect((SELECT count(*) FROM deal_commissions) = 0, 'B cannot see A commissions');
SELECT pg_temp.expect((SELECT count(*) FROM commission_splits) = 0, 'B cannot see A commission splits');
SELECT set_config('app.company_id', 'co-a', true);

-- 26. Phase 9a: plans, subscriptions, following, public profiles and notices are protected in the database.
SELECT set_config('app.user_id', 'u1', true);
SELECT pg_temp.expect((SELECT count(*) FROM subscription_plans) >= 6, 'a signed-in person reads the starting plans');
SELECT pg_temp.expect((SELECT count(*) FROM plan_entitlements WHERE key = 'COLLAB_SEEKER_AGENT') >= 1, 'the starting plans carry their features');
DO $$ BEGIN
  INSERT INTO subscription_plans (id, code, name, audience, updated_at) VALUES ('pl-x', 'sneaky', 'Sneaky', 'SEEKER', now());
  RAISE EXCEPTION 'FAIL: a non-administrator created a plan';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: only the platform administrator creates plans'; END $$;
SELECT set_config('app.platform_admin', 'on', true);
DO $$ BEGIN
  INSERT INTO subscription_plans (id, code, name, audience, grace_days, updated_at) VALUES ('pl-bad', 'bad-plan', 'Bad', 'SEEKER', -1, now());
  RAISE EXCEPTION 'FAIL: negative grace days were allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: grace days cannot be negative'; END $$;
DO $$ BEGIN
  INSERT INTO subscription_plans (id, code, name, audience, updated_at) VALUES ('pl-bad', 'BAD CODE', 'Bad', 'SEEKER', now());
  RAISE EXCEPTION 'FAIL: a malformed plan code was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: plan codes are tidy'; END $$;
INSERT INTO subscription_plans (id, code, name, audience, updated_at) VALUES ('pl-t', 'test-plan', 'Test plan', 'SEEKER', now());
DO $$ BEGIN
  INSERT INTO subscriptions (id, owner_kind, owner_user_id, owner_company_id, plan_id, period_end, created_by_id, updated_at) VALUES ('sb-bad', 'USER', 'u1', 'co-a', 'pl-t', now() + interval '30 days', 'adm', now());
  RAISE EXCEPTION 'FAIL: a subscription with two owners was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a subscription has exactly one owner'; END $$;
DO $$ BEGIN
  INSERT INTO subscriptions (id, owner_kind, owner_user_id, plan_id, started_at, period_end, created_by_id, updated_at) VALUES ('sb-bad', 'USER', 'u1', 'pl-t', now(), now() - interval '1 day', 'adm', now());
  RAISE EXCEPTION 'FAIL: a subscription ending before it started was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a subscription period is forward'; END $$;
INSERT INTO subscriptions (id, owner_kind, owner_user_id, plan_id, period_end, created_by_id, updated_at) VALUES ('sb-u1', 'USER', 'u1', 'pl-t', now() + interval '30 days', 'adm', now());
INSERT INTO subscriptions (id, owner_kind, owner_company_id, plan_id, period_end, created_by_id, updated_at) VALUES ('sb-ca', 'COMPANY', 'co-a', 'pl-t', now() + interval '30 days', 'adm', now());
DO $$ BEGIN
  UPDATE subscriptions SET status = 'CANCELLED' WHERE id = 'sb-u1';
  RAISE EXCEPTION 'FAIL: a cancelled subscription without a date was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a cancellation is dated'; END $$;
SELECT set_config('app.platform_admin', '', true);
SELECT pg_temp.expect((SELECT count(*) FROM subscriptions) = 2, 'the owner of a person plan and a company plan sees them from the right context');
SELECT set_config('app.user_id', 'u2', true);
SELECT set_config('app.company_id', 'co-b', true);
SELECT pg_temp.expect((SELECT count(*) FROM subscriptions) = 0, 'another person and company cannot see them');
DO $$ BEGIN
  UPDATE subscriptions SET period_end = now() + interval '900 days';
  IF FOUND THEN RAISE EXCEPTION 'FAIL: a non-administrator changed a subscription'; END IF;
  RAISE NOTICE 'ok: nobody but the administrator changes subscriptions';
END $$;
SELECT set_config('app.user_id', 'u1', true);
SELECT set_config('app.company_id', 'co-a', true);
DO $$ BEGIN
  UPDATE subscriptions SET period_end = now() + interval '900 days' WHERE id = 'sb-u1';
  IF FOUND THEN RAISE EXCEPTION 'FAIL: an owner changed their own subscription'; END IF;
  RAISE NOTICE 'ok: owners cannot extend their own subscription';
END $$;

-- Following belongs to the follower; the count is kept without exposing who follows.
SELECT set_config('app.user_id', 'u9', true);
SELECT set_config('app.company_id', 'co-a', true);
INSERT INTO agent_profiles (id, membership_id, user_id, company_id, display_name, listed, updated_at) VALUES ('ap-9', 'm9', 'u9', 'co-a', 'Agent Nine', true, now());
INSERT INTO agent_profiles (id, membership_id, user_id, company_id, display_name, listed, updated_at) VALUES ('ap-8', 'm8', 'u9', 'co-a', 'Hidden Agent', false, now());
DO $$ BEGIN
  INSERT INTO agent_profiles (id, membership_id, user_id, company_id, display_name, updated_at) VALUES ('ap-x', 'm7', 'u1', 'co-a', 'Someone else', now());
  RAISE EXCEPTION 'FAIL: a profile was written for another person';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: a profile can only be written by its owner'; END $$;
INSERT INTO company_profiles (id, company_id, display_name, listed, updated_at) VALUES ('cp-a', 'co-a', 'Alpha Estates', true, now());
SELECT set_config('app.user_id', 'u1', true);
SELECT set_config('app.company_id', '', true);
SELECT pg_temp.expect((SELECT count(*) FROM agent_profiles) = 1, 'the public sees only listed agent profiles');
SELECT pg_temp.expect((SELECT count(*) FROM company_profiles) = 1, 'the public sees listed company profiles');
DO $$ BEGIN
  INSERT INTO follows (id, follower_id, target_kind, target_id) VALUES ('fw-self', 'u1', 'AGENT', 'u1');
  RAISE EXCEPTION 'FAIL: a person followed themselves';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: nobody follows themselves'; END $$;
DO $$ BEGIN
  INSERT INTO follows (id, follower_id, target_kind, target_id) VALUES ('fw-x', 'u2', 'AGENT', 'u9');
  RAISE EXCEPTION 'FAIL: a follow was recorded for someone else';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: a follow is recorded only by the follower'; END $$;
INSERT INTO follows (id, follower_id, target_kind, target_id) VALUES ('fw-1', 'u1', 'AGENT', 'u9');
INSERT INTO follows (id, follower_id, target_kind, target_id) VALUES ('fw-2', 'u1', 'COMPANY', 'co-a');
DO $$ BEGIN
  INSERT INTO follows (id, follower_id, target_kind, target_id) VALUES ('fw-dup', 'u1', 'AGENT', 'u9');
  RAISE EXCEPTION 'FAIL: the same follow was recorded twice';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'ok: a follow is recorded once'; END $$;
SELECT pg_temp.expect((SELECT follower_count FROM agent_profiles WHERE id = 'ap-9') = 1, 'the agent follower count follows the follows table');
SELECT pg_temp.expect((SELECT follower_count FROM company_profiles WHERE id = 'cp-a') = 1, 'the company follower count follows the follows table');
SELECT set_config('app.user_id', 'u2', true);
SELECT pg_temp.expect((SELECT count(*) FROM follows) = 0, 'nobody can read another person''s follows');
SELECT set_config('app.user_id', 'u1', true);
DELETE FROM follows WHERE id = 'fw-1';
SELECT pg_temp.expect((SELECT follower_count FROM agent_profiles WHERE id = 'ap-9') = 0, 'unfollowing lowers the count');

-- Notices: anyone signed in leaves one; only its owner reads it.
INSERT INTO notifications (id, user_id, kind, title) VALUES ('nt-1', 'u2', 'test', 'For u2');
SELECT pg_temp.expect((SELECT count(*) FROM notifications) = 0, 'the sender cannot read the notice they left');
SELECT set_config('app.user_id', 'u2', true);
SELECT pg_temp.expect((SELECT count(*) FROM notifications) = 1, 'the recipient reads their notice');
SELECT set_config('app.user_id', '', true);
DO $$ BEGIN
  INSERT INTO notifications (id, user_id, kind, title) VALUES ('nt-2', 'u2', 'test', 'Anonymous');
  RAISE EXCEPTION 'FAIL: a signed-out visitor left a notice';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: only signed-in people leave notices'; END $$;
SELECT set_config('app.user_id', 'u1', true);
SELECT set_config('app.company_id', 'co-a', true);

-- 27. Phase 9b: collaborations are visible to their two parties only, and what one party shared cannot be altered by the other.
SELECT set_config('app.user_id', 'u1', true);
SELECT set_config('app.company_id', '', true);
DO $$ BEGIN
  INSERT INTO collaborations (id, ref, kind, purpose, title, status, sender_user_id, sender_name, recipient_user_id, recipient_company_id, recipient_name, updated_at)
    VALUES ('cb-bad', 'COL-BAD', 'SEEKER_AGENT', 'OTHER', 'Spoofed sender', 'DRAFT', 'u2', 'Spoof', 'u9', 'co-a', 'Agent Nine', now());
  RAISE EXCEPTION 'FAIL: an invitation was created in someone else''s name';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: an invitation can only be created by its sender'; END $$;
DO $$ BEGIN
  INSERT INTO collaborations (id, ref, kind, purpose, title, status, sender_user_id, sender_company_id, sender_name, recipient_user_id, recipient_company_id, recipient_name, updated_at)
    VALUES ('cb-bad', 'COL-BAD', 'SEEKER_AGENT', 'OTHER', 'Seeker with a company', 'DRAFT', 'u1', 'co-b', 'U1', 'u9', 'co-a', 'Agent Nine', now());
  RAISE EXCEPTION 'FAIL: a seeker invitation carried a sender company';
EXCEPTION WHEN check_violation OR insufficient_privilege THEN RAISE NOTICE 'ok: a seeker invitation has no sender company'; END $$;
INSERT INTO collaborations (id, ref, kind, purpose, title, status, sender_user_id, sender_name, recipient_user_id, recipient_company_id, recipient_name, updated_at)
  VALUES ('cb-1', 'COL-0001', 'SEEKER_AGENT', 'SEARCH_ASSISTANCE', 'Find me a flat', 'DRAFT', 'u1', 'Seeker One', 'u9', 'co-a', 'Agent Nine', now());
DO $$ BEGIN
  UPDATE collaborations SET status = 'PENDING', sent_at = now() WHERE id = 'cb-1';
  RAISE EXCEPTION 'FAIL: a pending invitation without an expiry was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a pending invitation expires'; END $$;
UPDATE collaborations SET status = 'PENDING', sent_at = now(), expires_at = now() + interval '14 days' WHERE id = 'cb-1';
DO $$ BEGIN
  UPDATE collaborations SET status = 'ACTIVE', responded_at = now(), responded_by_id = 'u1' WHERE id = 'cb-1';
  RAISE EXCEPTION 'FAIL: the sender accepted their own invitation';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: the other side answers, never the sender'; END $$;
DO $$ BEGIN
  UPDATE collaborations SET status = 'SUSPENDED', suspended_at = now(), suspended_by_id = 'u1', suspended_by = 'SENDER', suspend_reason = '' WHERE id = 'cb-1';
  RAISE EXCEPTION 'FAIL: a suspension without a reason was allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: a suspension says why'; END $$;
DO $$ BEGIN
  INSERT INTO collaborations (id, ref, kind, purpose, title, status, sender_user_id, sender_company_id, sender_name, recipient_company_id, recipient_name, updated_at)
    VALUES ('cb-self', 'COL-SELF', 'COMPANY_COMPANY', 'OTHER', 'With ourselves', 'DRAFT', 'u1', 'co-a', 'U1', 'co-a', 'Alpha', now());
  RAISE EXCEPTION 'FAIL: a company invited itself';
EXCEPTION WHEN check_violation OR insufficient_privilege THEN RAISE NOTICE 'ok: a company cannot invite itself'; END $$;
INSERT INTO collab_participants (id, collaboration_id, side, user_id, name, added_by_id) VALUES ('cp-1', 'cb-1', 'SENDER', 'u1', 'Seeker One', 'u1');
INSERT INTO collab_items (id, collaboration_id, kind, title, summary, details, side, shared_by_id, shared_by_name, updated_at)
  VALUES ('ci-1', 'cb-1', 'NOTE', 'My budget', 'Up to 40m', '{"fields":[1]}', 'SENDER', 'u1', 'Seeker One', now());
DO $$ BEGIN
  UPDATE collab_items SET revoked_at = now(), revoked_by_id = 'u1' WHERE id = 'ci-1';
  RAISE EXCEPTION 'FAIL: a revoked item kept its content';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: revoking wipes what was shared'; END $$;
INSERT INTO collab_events (id, collaboration_id, actor_id, actor_name, kind, summary) VALUES ('ce-1', 'cb-1', 'u1', 'Seeker One', 'created', 'Invitation created');

-- The agent, in their company, sees the invitation; a stranger sees nothing.
SELECT set_config('app.user_id', 'u9', true);
SELECT set_config('app.company_id', 'co-a', true);
SELECT pg_temp.expect((SELECT count(*) FROM collaborations WHERE id = 'cb-1') = 1, 'the recipient agent sees the invitation');
SELECT pg_temp.expect((SELECT count(*) FROM collab_items WHERE collaboration_id = 'cb-1') = 1, 'the recipient sees what was shared');
DO $$ BEGIN
  UPDATE collab_items SET summary = 'Tampered' WHERE id = 'ci-1';
  IF FOUND THEN RAISE EXCEPTION 'FAIL: the other party changed what was shared'; END IF;
  RAISE NOTICE 'ok: the other party cannot change what was shared';
END $$;
DO $$ BEGIN
  DELETE FROM collab_items WHERE id = 'ci-1';
  IF FOUND THEN RAISE EXCEPTION 'FAIL: the other party deleted what was shared'; END IF;
  RAISE NOTICE 'ok: the other party cannot delete what was shared';
END $$;
DO $$ BEGIN
  UPDATE collab_events SET summary = 'Changed' WHERE id = 'ce-1';
  RAISE EXCEPTION 'FAIL: the workspace history was edited';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: the workspace history is append-only'; END $$;
SELECT set_config('app.user_id', 'u3', true);
SELECT set_config('app.company_id', 'co-c', true);
SELECT pg_temp.expect((SELECT count(*) FROM collaborations) = 0, 'a stranger sees no collaboration');
SELECT pg_temp.expect((SELECT count(*) FROM collab_items) = 0, 'a stranger sees nothing shared');
SELECT pg_temp.expect((SELECT count(*) FROM collab_participants) = 0, 'a stranger sees no participants');
DO $$ BEGIN
  INSERT INTO collab_items (id, collaboration_id, kind, title, side, shared_by_id, shared_by_name, updated_at) VALUES ('ci-x', 'cb-1', 'NOTE', 'Injected', 'RECIPIENT', 'u3', 'Stranger', now());
  RAISE EXCEPTION 'FAIL: a stranger added to a workspace';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: a stranger cannot add to a workspace'; END $$;

-- Company to company: each company sees the pair, the third does not, and the partner's plan state is readable but not its other records.
SELECT set_config('app.user_id', 'u1', true);
SELECT set_config('app.company_id', 'co-a', true);
INSERT INTO collaborations (id, ref, kind, purpose, title, status, sender_user_id, sender_company_id, sender_name, recipient_company_id, recipient_name, updated_at)
  VALUES ('cb-2', 'COL-0002', 'COMPANY_COMPANY', 'CO_BROKERAGE', 'Joint sale', 'DRAFT', 'u1', 'co-a', 'Alpha Estates', 'co-b', 'Beta Property', now());
SELECT set_config('app.user_id', 'u5', true);
SELECT set_config('app.company_id', 'co-b', true);
SELECT pg_temp.expect((SELECT count(*) FROM collaborations WHERE id = 'cb-2') = 1, 'the invited company sees the invitation');
SELECT pg_temp.expect((SELECT count(*) FROM subscriptions WHERE owner_company_id = 'co-a') = 1, 'the partner company''s plan state is readable');
SELECT pg_temp.expect((SELECT count(*) FROM deals WHERE company_id = 'co-a') = 0, 'the partner company still sees none of the other company''s deals');
SELECT pg_temp.expect((SELECT count(*) FROM assets WHERE company_id = 'co-a') = 0, 'the partner company still sees none of the other company''s assets');
SELECT set_config('app.user_id', 'u3', true);
SELECT set_config('app.company_id', 'co-c', true);
SELECT pg_temp.expect((SELECT count(*) FROM subscriptions WHERE owner_company_id = 'co-a') = 0, 'an unrelated company cannot read the plan state');
SELECT set_config('app.platform_admin', 'on', true);
SELECT pg_temp.expect((SELECT count(*) FROM collaborations) = 2, 'the platform administrator sees every collaboration');
SELECT set_config('app.platform_admin', '', true);
SELECT set_config('app.user_id', 'u1', true);
SELECT set_config('app.company_id', 'co-a', true);

-- ============================================================
-- 28. Messaging: a conversation is read only by its members
-- ============================================================
SELECT set_config('app.user_id', 'u1', true);
SELECT set_config('app.company_id', '', true);
INSERT INTO conversations (id, created_by_id) VALUES ('cv-1', 'u1');
INSERT INTO conversation_members (id, conversation_id, user_id, name) VALUES ('cm-1', 'cv-1', 'u1', 'One'), ('cm-2', 'cv-1', 'u5', 'Five');
INSERT INTO messages (id, conversation_id, sender_id, sender_name, body) VALUES ('ms-1', 'cv-1', 'u1', 'One', 'Hello there');
SELECT set_config('app.user_id', 'u5', true);
SELECT pg_temp.expect((SELECT count(*) FROM messages WHERE id = 'ms-1') = 1, 'a member reads the message');
SELECT pg_temp.expect((SELECT count(*) FROM conversations WHERE id = 'cv-1') = 1, 'a member sees the conversation');
INSERT INTO messages (id, conversation_id, sender_id, sender_name, body) VALUES ('ms-2', 'cv-1', 'u5', 'Five', 'Hi back');
DO $$ BEGIN
  INSERT INTO messages (id, conversation_id, sender_id, sender_name, body) VALUES ('ms-x', 'cv-1', 'u1', 'One', 'Pretending to be someone else');
  RAISE EXCEPTION 'FAIL: spoofed sender';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: a member cannot send as someone else'; END $$;
SELECT set_config('app.user_id', 'u3', true);
SELECT pg_temp.expect((SELECT count(*) FROM messages) = 0, 'an outsider reads no messages');
SELECT pg_temp.expect((SELECT count(*) FROM conversations) = 0, 'an outsider sees no conversations');
SELECT pg_temp.expect((SELECT count(*) FROM conversation_members) = 0, 'an outsider sees no members');
DO $$ BEGIN
  INSERT INTO messages (id, conversation_id, sender_id, sender_name, body) VALUES ('ms-y', 'cv-1', 'u3', 'Three', 'Let me in');
  RAISE EXCEPTION 'FAIL: outsider posted';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: an outsider cannot post into a conversation'; END $$;
DO $$ BEGIN
  INSERT INTO conversation_members (id, conversation_id, user_id, name) VALUES ('cm-x', 'cv-1', 'u3', 'Three');
  RAISE EXCEPTION 'FAIL: outsider added themself';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: nobody can add themself to someone else''s conversation'; END $$;
SELECT set_config('app.user_id', 'u5', true);
DO $$ BEGIN
  INSERT INTO conversation_members (id, conversation_id, user_id, name) VALUES ('cm-y', 'cv-1', 'u3', 'Three');
  RAISE EXCEPTION 'FAIL: non-creator added a member';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: only the person who started a conversation can add to it'; END $$;
DO $$ BEGIN
  UPDATE messages SET body = 'edited' WHERE id = 'ms-1';
  IF FOUND THEN RAISE EXCEPTION 'FAIL: a message was edited'; END IF;
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: messages cannot be edited'; END $$;

-- Reports: the platform administrator reads only what was reported.
SELECT set_config('app.user_id', 'u3', true);
DO $$ BEGIN
  INSERT INTO message_reports (id, message_id, reporter_id, reporter_name, sender_id, reason) VALUES ('mr-x', 'ms-1', 'u3', 'Three', 'u1', 'not mine to report');
  RAISE EXCEPTION 'FAIL: outsider reported a message they cannot read';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: an outsider cannot report a message'; END $$;
SELECT set_config('app.user_id', 'u5', true);
INSERT INTO message_reports (id, message_id, reporter_id, reporter_name, sender_id, reason) VALUES ('mr-1', 'ms-1', 'u5', 'Five', 'u1', 'Asked for my phone number');
SELECT set_config('app.user_id', 'u1', true);
SELECT pg_temp.expect((SELECT count(*) FROM message_reports) = 0, 'the person reported cannot see the report');
SELECT set_config('app.user_id', 'padmin', true);
SELECT set_config('app.platform_admin', 'on', true);
SELECT pg_temp.expect((SELECT count(*) FROM messages) = 1, 'the administrator reads only the reported message, not the whole conversation');
SELECT pg_temp.expect((SELECT count(*) FROM message_reports) = 1, 'the administrator sees the report');
SELECT set_config('app.platform_admin', '', true);

-- Blocks are private; the check function answers without revealing who blocked.
SELECT set_config('app.user_id', 'u1', true);
INSERT INTO user_blocks (id, blocker_id, blocked_id) VALUES ('ub-1', 'u1', 'u5');
SELECT set_config('app.user_id', 'u5', true);
SELECT pg_temp.expect((SELECT count(*) FROM user_blocks) = 0, 'a blocked person cannot read the block');
SELECT pg_temp.expect(msg_blocked('u5', 'u1'), 'the block is still honoured for the blocked person');
SELECT pg_temp.expect(NOT msg_blocked('u5', 'u3'), 'no block between unrelated people');

-- Restrictions are the administrator's to set.
DO $$ BEGIN
  INSERT INTO messaging_restrictions (id, user_id, reason, set_by_id) VALUES ('mx-x', 'u5', 'self', 'u5');
  RAISE EXCEPTION 'FAIL: a user restricted themself or another';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: only the administrator sets a restriction'; END $$;
SELECT set_config('app.user_id', 'u1', true);

-- 29. Rewards: people read only their own; only the administrator writes; the ledger cannot be edited.
SELECT set_config('app.user_id', 'padmin', true);
SELECT set_config('app.platform_admin', 'on', true);
INSERT INTO rewards (id, ref, user_id, programme, event, amount_kobo, status, source_type, source_id, updated_at) VALUES ('rw-1', 'RW-1', 'u1', 'REFERRAL', 'REFERRAL_REGISTERED', 100000, 'ELIGIBLE', 'user', 'x1', now());
INSERT INTO reward_ledger (id, reward_id, user_id, to_status, amount_kobo, actor_name) VALUES ('rl-1', 'rw-1', 'u1', 'ELIGIBLE', 100000, 'Platform');
SELECT set_config('app.platform_admin', '', true);
SELECT set_config('app.user_id', 'u1', true);
SELECT pg_temp.expect((SELECT count(*) FROM rewards) = 1, 'a person reads their own reward');
SELECT pg_temp.expect((SELECT count(*) FROM reward_ledger) = 1, 'a person reads their own ledger');
SELECT set_config('app.user_id', 'u3', true);
SELECT pg_temp.expect((SELECT count(*) FROM rewards) = 0, 'another person cannot read the reward');
SELECT pg_temp.expect((SELECT count(*) FROM reward_ledger) = 0, 'another person cannot read the ledger');
DO $$ BEGIN
  INSERT INTO rewards (id, ref, user_id, programme, event, amount_kobo, status, source_type, source_id, updated_at) VALUES ('rw-x', 'RW-X', 'u3', 'REFERRAL', 'REFERRAL_REGISTERED', 999999, 'ELIGIBLE', 'user', 'x2', now());
  RAISE EXCEPTION 'FAIL: a person created their own reward';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: a person cannot create a reward'; END $$;
SELECT set_config('app.user_id', 'u1', true);
DO $$ DECLARE n int; BEGIN
  UPDATE rewards SET status = 'APPROVED' WHERE id = 'rw-1';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: a person approved their own reward'; END IF;
  RAISE NOTICE 'ok: a person cannot approve their own reward';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: a person cannot approve their own reward'; END $$;
DO $$ BEGIN
  INSERT INTO reward_disputes (id, subject_type, subject_id, user_id, reason, status) VALUES ('rd-x', 'REWARD', 'rw-1', 'u1', 'long enough reason here', 'UPHELD');
  RAISE EXCEPTION 'FAIL: a person decided their own dispute';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: a dispute can only be opened'; END $$;
SELECT set_config('app.user_id', 'padmin', true);
SELECT set_config('app.platform_admin', 'on', true);
DO $$ BEGIN
  UPDATE reward_ledger SET note = 'edited' WHERE id = 'rl-1';
  RAISE EXCEPTION 'FAIL: ledger was edited';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: the ledger is append-only'; END $$;
SELECT set_config('app.platform_admin', '', true);
SELECT set_config('app.user_id', 'u1', true);

-- 30. Vacancy reports: only the reporter and the review team can read one; nobody else, not even an owner or another reporter.
SELECT set_config('app.user_id', 'u1', true);
INSERT INTO vacancy_reports (id, ref, reporter_id, reporter_name, property_type, address, area, city, state, address_key, description, description_hash, observed_on, cluster_id, updated_at)
  VALUES ('vr-1', 'VR-1', 'u1', 'One', 'FLAT', '12 Allen Avenue', 'Ikeja', 'Lagos', 'Lagos', 'k', 'A two bedroom flat with a to-let board outside', 'h', current_date, 'vr-1', now());
INSERT INTO vacancy_files (id, report_id, name, mime_type, size_bytes, sha256, bytes) VALUES ('vf-1', 'vr-1', 'a.jpg', 'image/jpeg', 3, 'abc', '\x010203');
SELECT pg_temp.expect((SELECT count(*) FROM vacancy_reports) = 1, 'the reporter reads their own report');
SELECT pg_temp.expect((SELECT count(*) FROM vacancy_files) = 1, 'the reporter reads their own photo');
DO $$ BEGIN
  INSERT INTO vacancy_reports (id, ref, reporter_id, reporter_name, property_type, address, area, city, state, address_key, description, description_hash, observed_on, cluster_id, updated_at)
    VALUES ('vr-x', 'VR-X', 'u3', 'Three', 'FLAT', 'x', 'x', 'x', 'x', 'k', 'A report filed in somebody else''s name', 'h', current_date, 'vr-x', now());
  RAISE EXCEPTION 'FAIL: reported as someone else';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: nobody can file a report in another name'; END $$;
DO $$ DECLARE n int; BEGIN
  UPDATE vacancy_reports SET outcome = 'APPROVED', stage = 'REWARD_REVIEW', closed_at = now() WHERE id = 'vr-1';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: a reporter approved their own report'; END IF;
  RAISE NOTICE 'ok: a reporter cannot approve their own report';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: a reporter cannot approve their own report'; END $$;
SELECT set_config('app.user_id', 'u3', true);
SELECT pg_temp.expect((SELECT count(*) FROM vacancy_reports) = 0, 'another reporter cannot read the report');
SELECT pg_temp.expect((SELECT count(*) FROM vacancy_files) = 0, 'another reporter cannot read the photo');
SELECT set_config('app.user_id', 'padmin', true);
SELECT set_config('app.platform_admin', 'on', true);
INSERT INTO vacancy_events (id, report_id, actor_name, note, to_reporter) VALUES ('ve-1', 'vr-1', 'Review', 'Shown to the reporter', true), ('ve-2', 'vr-1', 'Review', 'Internal note', false);
INSERT INTO vacancy_leads (id, report_id, contact_name, created_by_id, updated_at) VALUES ('vl-1', 'vr-1', 'The owner', 'padmin', now());
SELECT pg_temp.expect((SELECT count(*) FROM vacancy_reports) = 1, 'the review team reads the report');
SELECT pg_temp.expect((SELECT count(*) FROM vacancy_events) = 2, 'the review team reads every note');
SELECT set_config('app.platform_admin', '', true);
SELECT set_config('app.user_id', 'u1', true);
SELECT pg_temp.expect((SELECT count(*) FROM vacancy_events) = 1, 'the reporter sees only the history meant for them');
SELECT pg_temp.expect((SELECT count(*) FROM vacancy_leads) = 0, 'the reporter cannot see the owner lead');
DO $$ BEGIN
  INSERT INTO vacancy_events (id, report_id, actor_name, note) VALUES ('ve-x', 'vr-1', 'One', 'forged history');
  RAISE EXCEPTION 'FAIL: reporter wrote history';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: only the review team writes history'; END $$;
DO $$ BEGIN
  UPDATE vacancy_events SET note = 'edited' WHERE id = 've-1';
  RAISE EXCEPTION 'FAIL: history was edited';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: history is append-only'; END $$;

-- 31. Phase 11: promotions are public only once approved; payments and ratings are private; a company cannot approve its own promotion.
SELECT set_config('app.platform_admin', 'on', true);
SELECT set_config('app.user_id', 'padmin', true);
INSERT INTO promo_campaigns (id, name, starts_on, ends_on, created_by_id) VALUES ('pc-1', 'Black Friday', current_date - 1, current_date + 10, 'padmin');
SELECT set_config('app.platform_admin', '', true);
SELECT set_config('app.company_id', 'co-a', true);
SELECT set_config('app.user_id', 'u1', true);
INSERT INTO promo_entries (id, ref, campaign_id, company_id, listing_id, original_price_kobo, promo_price_kobo, status, requested_by_id, updated_at)
  VALUES ('pe-a', 'PRM-A', 'pc-1', 'co-a', 'li-a', 100, 80, 'REQUESTED', 'u1', now());
INSERT INTO promo_payments (id, entry_id, company_id, tier_at_request, fee_kobo, status) VALUES ('pp-a', 'pe-a', 'co-a', 'BASIC', 5000, 'PENDING');
DO $$ DECLARE n int; BEGIN
  UPDATE promo_entries SET status = 'APPROVED', reviewed_by_id = 'u1', reviewed_at = now() WHERE id = 'pe-a';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: a company approved its own promotion'; END IF;
  RAISE NOTICE 'ok: a company cannot approve its own promotion';
EXCEPTION WHEN insufficient_privilege OR check_violation THEN RAISE NOTICE 'ok: a company cannot approve its own promotion'; END $$;
DO $$ DECLARE n int; BEGIN
  UPDATE promo_payments SET status = 'VERIFIED', reference = 'SELF-PAID', verified_by_id = 'u1', verified_at = now() WHERE id = 'pp-a';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: a company confirmed its own payment'; END IF;
  RAISE NOTICE 'ok: a company cannot confirm its own payment';
EXCEPTION WHEN insufficient_privilege OR check_violation THEN RAISE NOTICE 'ok: a company cannot confirm its own payment'; END $$;
-- The public (and another company) sees nothing of a request that is not approved, and never a payment.
SELECT set_config('app.company_id', 'co-b', true);
SELECT set_config('app.user_id', 'u2', true);
SELECT pg_temp.expect((SELECT count(*) FROM promo_entries) = 0, 'another company cannot see a pending promotion');
SELECT pg_temp.expect((SELECT count(*) FROM promo_payments) = 0, 'another company cannot see a promotion payment');
SELECT set_config('app.platform_admin', 'on', true);
UPDATE promo_entries SET status = 'APPROVED', reviewed_by_id = 'padmin', reviewed_at = now() WHERE id = 'pe-a';
SELECT set_config('app.platform_admin', '', true);
SELECT pg_temp.expect((SELECT count(*) FROM promo_entries) = 1, 'anyone can see an approved promotion');
SELECT pg_temp.expect((SELECT count(*) FROM promo_payments) = 0, 'an approved promotion still hides its payment');
SELECT set_config('app.company_id', '', true);
SELECT pg_temp.expect((SELECT count(*) FROM promo_campaigns) = 1, 'the public reads campaigns');
DO $$ BEGIN
  INSERT INTO promo_campaigns (id, name, starts_on, ends_on, created_by_id) VALUES ('pc-x', 'Fake sale', current_date, current_date + 1, 'u2');
  RAISE EXCEPTION 'FAIL: a campaign was created by a non-administrator';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: only the administrator creates campaigns'; END $$;
-- Tiers are public to read, written only by the administrator.
DO $$ BEGIN
  INSERT INTO company_tiers (company_id, tier, valid_until, updated_at) VALUES ('co-b', 'GOLD', now() + interval '1 day', now());
  RAISE EXCEPTION 'FAIL: a company gave itself Gold';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: a company cannot give itself a tier'; END $$;
-- Ratings: private to the person who gave them and the administrator.
SELECT set_config('app.user_id', 'u1', true);
INSERT INTO platform_ratings (id, user_id, overall, user_kind) VALUES ('pr-1', 'u1', 4, 'MEMBER');
DO $$ BEGIN
  INSERT INTO platform_ratings (id, user_id, overall, user_kind) VALUES ('pr-x', 'u3', 5, 'MEMBER');
  RAISE EXCEPTION 'FAIL: rated in another name';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: nobody rates in another name'; END $$;
DO $$ BEGIN
  INSERT INTO platform_ratings (id, user_id, overall, user_kind) VALUES ('pr-y', 'u1', 6, 'MEMBER');
  RAISE EXCEPTION 'FAIL: a rating of 6 was accepted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: ratings run from 1 to 5'; END $$;
SELECT pg_temp.expect((SELECT count(*) FROM platform_ratings) = 1, 'a person reads their own rating');
SELECT set_config('app.user_id', 'u3', true);
SELECT pg_temp.expect((SELECT count(*) FROM platform_ratings) = 0, 'another person cannot read the rating');
SELECT set_config('app.user_id', 'u1', true);

-- 32. Phase 12a: reviews are public only while published; the reviewer reads their own; only the platform writes; invites open by their link alone.
SELECT set_config('app.company_id', '', true);
SELECT set_config('app.user_id', 'padmin', true);
SELECT set_config('app.platform_admin', 'on', true);
INSERT INTO reviews (id, ref, company_id, agent_user_id, reviewer_id, reviewer_name, basis, basis_ref, overall, status, updated_at)
  VALUES ('rv-1', 'REV-1', 'co-a', 'u1', 'u3', 'Three Person', 'TRANSACTION', 'd1', 5, 'PUBLISHED', now()),
         ('rv-2', 'REV-2', 'co-a', 'u1', 'u3', 'Three Person', 'ENQUIRY', 'c1', 1, 'HELD', now());
INSERT INTO review_events (id, review_id, reviewer_id, actor_name, kind, to_reviewer) VALUES ('re-1', 'rv-1', 'u3', 'Three', 'SUBMITTED', true), ('re-2', 'rv-1', 'u3', 'Platform', 'NOTE', false);
INSERT INTO reputation_snapshots (id, subject_kind, subject_id, score, review_count, average, formula, inputs, components, badges, inputs_hash) VALUES ('rs-1', 'AGENT', 'u1', 70, 1, 5, 1, '{}', '{}', '[]', 'h');
INSERT INTO review_invites (id, token_hash, company_id, basis, basis_ref, created_by_id, expires_at) VALUES ('ri-1', 'hash-one', 'co-a', 'TRANSACTION', 'dx', 'u1', now() + interval '1 day');
SELECT set_config('app.platform_admin', '', true);
SELECT set_config('app.user_id', '', true);
SELECT pg_temp.expect((SELECT count(*) FROM reviews) = 1, 'the public sees only the published review');
SELECT pg_temp.expect((SELECT count(*) FROM reputation_snapshots) = 1, 'the public reads reputation');
SELECT pg_temp.expect((SELECT count(*) FROM review_events) = 0, 'the public reads no review history');
SELECT pg_temp.expect((SELECT count(*) FROM review_invites) = 0, 'the public sees no invites');
SELECT set_config('app.user_id', 'u3', true);
SELECT pg_temp.expect((SELECT count(*) FROM reviews) = 2, 'the reviewer reads their own, including a held one');
SELECT pg_temp.expect((SELECT count(*) FROM review_events) = 1, 'the reviewer reads only the history meant for them');
SELECT set_config('app.user_id', 'u1', true);
SELECT pg_temp.expect((SELECT count(*) FROM reviews) = 1, 'the reviewed agent sees only the published review');
DO $$ BEGIN
  INSERT INTO reviews (id, ref, company_id, agent_user_id, reviewer_id, reviewer_name, basis, basis_ref, overall, updated_at) VALUES ('rv-x', 'REV-X', 'co-a', 'u1', 'u1', 'One', 'ENQUIRY', 'cx', 5, now());
  RAISE EXCEPTION 'FAIL: a review was written outside the platform''s own code';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: nobody writes a review directly'; END $$;
DO $$ DECLARE n int; BEGIN
  UPDATE reviews SET status = 'REMOVED' WHERE id = 'rv-1';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: a review was taken down by a non-administrator'; END IF;
  RAISE NOTICE 'ok: only the platform changes a review';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: only the platform changes a review'; END $$;
SELECT set_config('app.user_id', 'u3', true);
DO $$ BEGIN
  INSERT INTO reviews (id, ref, company_id, agent_user_id, reviewer_id, reviewer_name, basis, basis_ref, overall, updated_at) VALUES ('rv-y', 'REV-Y', 'co-a', 'u1', 'u3', 'Three', 'ENQUIRY', 'cy', 6, now());
  RAISE EXCEPTION 'FAIL: a rating of 6 was accepted';
EXCEPTION WHEN insufficient_privilege OR check_violation THEN RAISE NOTICE 'ok: ratings run from 1 to 5'; END $$;
-- Invites open to whoever holds the link, and to their company.
SELECT set_config('app.invite_token_hash', 'hash-one', true);
SELECT pg_temp.expect((SELECT count(*) FROM review_invites) = 1, 'the holder of a link can read its invite');
SELECT set_config('app.invite_token_hash', '', true);
SELECT set_config('app.company_id', 'co-b', true);
SELECT pg_temp.expect((SELECT count(*) FROM review_invites) = 0, 'another company cannot see the invite');
SELECT set_config('app.company_id', 'co-a', true);
SELECT pg_temp.expect((SELECT count(*) FROM review_invites) = 1, 'the company sees its invite');
SELECT set_config('app.company_id', '', true);
DO $$ BEGIN
  UPDATE review_events SET note = 'edited' WHERE id = 're-1';
  RAISE EXCEPTION 'FAIL: history was edited';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: review history is append-only'; END $$;

-- 33. Phase 12b: only published rankings are public; disputes are private; completed deals are public only when approved, and only for the company's own eyes before that.
SELECT set_config('app.company_id', '', true);
SELECT set_config('app.user_id', 'padmin', true);
SELECT set_config('app.platform_admin', 'on', true);
INSERT INTO award_runs (id, month, version, status, config, inputs_hash, computed_by_id, published_at, published_by_id) VALUES
  ('ar-1', '2026-08', 1, 'PUBLISHED', '{}', 'h', 'padmin', now(), 'padmin'),
  ('ar-2', '2026-09', 1, 'DRAFT', '{}', 'h', 'padmin', NULL, NULL);
INSERT INTO award_entries (id, run_id, user_id, display_name, eligible, sales, posts, reviews, avg_rating, rating_score, norm_sales, norm_posts, norm_rating, score, rank, plaque, facts) VALUES
  ('ae-1', 'ar-1', 'u1', 'One', true, 2, 2, 3, 5, 4.2, 1, 1, 1, 100, 1, 'GOLD', '{}'),
  ('ae-2', 'ar-2', 'u1', 'One', true, 2, 2, 3, 5, 4.2, 1, 1, 1, 100, 1, 'GOLD', '{}');
INSERT INTO award_disputes (id, run_id, user_id, reason) VALUES ('ad-1', 'ar-1', 'u1', 'A sale is missing from my total');
INSERT INTO completed_displays (id, deal_id, company_id, kind, category, city, state, completed_at, status, authorised_by_id, authorisation, reviewed_by_id, reviewed_at) VALUES
  ('cd-1', 'dl-1', 'co-a', 'SOLD', 'Flat', 'Lekki', 'Lagos', now(), 'APPROVED', 'u1', 'Owner and buyer agreed by email', 'padmin', now()),
  ('cd-2', 'dl-2', 'co-a', 'RENTED', 'Flat', 'Ikeja', 'Lagos', now(), 'REQUESTED', 'u1', 'Owner and tenant agreed in writing', NULL, NULL);
SELECT set_config('app.platform_admin', '', true);
SELECT set_config('app.user_id', '', true);
SELECT pg_temp.expect((SELECT count(*) FROM award_runs) = 1, 'the public sees only the published run');
SELECT pg_temp.expect((SELECT count(*) FROM award_entries) = 1, 'the public sees only the lines of a published run');
SELECT pg_temp.expect((SELECT count(*) FROM award_disputes) = 0, 'the public sees no disputes');
SELECT pg_temp.expect((SELECT count(*) FROM completed_displays) = 1, 'the public sees only the approved completed deal');
SELECT set_config('app.user_id', 'u1', true);
SELECT pg_temp.expect((SELECT count(*) FROM award_entries) = 2, 'an agent sees their own lines, even in a draft');
SELECT pg_temp.expect((SELECT count(*) FROM award_disputes) = 1, 'an agent sees their own dispute');
SELECT set_config('app.user_id', 'u3', true);
SELECT pg_temp.expect((SELECT count(*) FROM award_disputes) = 0, 'another person cannot see the dispute');
SELECT set_config('app.company_id', 'co-a', true);
SELECT pg_temp.expect((SELECT count(*) FROM completed_displays) = 2, 'the company sees its own pending request');
SELECT set_config('app.company_id', 'co-b', true);
SELECT pg_temp.expect((SELECT count(*) FROM completed_displays) = 1, 'another company sees only the approved one');
SELECT set_config('app.company_id', '', true);
DO $$ BEGIN
  INSERT INTO award_runs (id, month, version, status, config, inputs_hash, computed_by_id) VALUES ('ar-x', '2026-07', 1, 'DRAFT', '{}', 'h', 'u3');
  RAISE EXCEPTION 'FAIL: a ranking was made by a non-administrator';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: only the administrator makes a ranking'; END $$;
DO $$ BEGIN
  INSERT INTO completed_displays (id, deal_id, company_id, kind, category, city, state, completed_at, status, authorised_by_id, authorisation, reviewed_by_id, reviewed_at)
    VALUES ('cd-x', 'dl-x', 'co-a', 'SOLD', 'Flat', 'Lekki', 'Lagos', now(), 'APPROVED', 'u3', 'I approve myself right now', 'u3', now());
  RAISE EXCEPTION 'FAIL: a completed deal was approved by its requester';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: nobody approves their own completed deal'; END $$;
DO $$ BEGIN
  INSERT INTO award_runs (id, month, version, status, config, inputs_hash, computed_by_id) VALUES ('ar-bad', '2026-13', 1, 'DRAFT', '{}', 'h', 'padmin');
  RAISE EXCEPTION 'FAIL: bad month';
EXCEPTION WHEN insufficient_privilege OR check_violation THEN RAISE NOTICE 'ok: a month must be real'; END $$;

-- 34. Phase 12c: only published reels are public; an author sees their own pending reel; saves and reports are private; hidden comments are not shown.
SELECT set_config('app.company_id', '', true);
SELECT set_config('app.user_id', 'padmin', true);
SELECT set_config('app.platform_admin', 'on', true);
INSERT INTO reels (id, author_id, company_id, mime_type, size_bytes, status, published_at, reviewed_by_id) VALUES
  ('rl-1', 'u1', 'co-a', 'video/mp4', 1000, 'PUBLISHED', now(), 'padmin'),
  ('rl-2', 'u1', 'co-a', 'video/mp4', 1000, 'PENDING', NULL, NULL),
  ('rl-3', 'u2', 'co-b', 'video/webm', 1000, 'HIDDEN', NULL, NULL);
INSERT INTO reel_media (reel_id, bytes) VALUES ('rl-1', '\x00'), ('rl-2', '\x00');
INSERT INTO reel_likes (id, reel_id, user_id) VALUES ('lk-1', 'rl-1', 'u3');
INSERT INTO reel_saves (id, reel_id, user_id) VALUES ('sv-1', 'rl-1', 'u3');
INSERT INTO reel_comments (id, reel_id, user_id, author_name, body, status) VALUES ('cm-1', 'rl-1', 'u3', 'Three', 'Lovely place', 'VISIBLE'), ('cm-2', 'rl-1', 'u3', 'Three', 'Rude words', 'HIDDEN');
INSERT INTO social_reports (id, target_kind, target_id, reel_id, reporter_id, reason) VALUES ('sr-1', 'REEL', 'rl-1', 'rl-1', 'u3', 'Misleading video');
SELECT set_config('app.platform_admin', '', true);
SELECT set_config('app.user_id', '', true);
SELECT pg_temp.expect((SELECT count(*) FROM reels) = 1, 'the public sees only the published reel');
SELECT pg_temp.expect((SELECT count(*) FROM reel_media) = 1, 'the public can only get the video of a published reel');
SELECT pg_temp.expect((SELECT count(*) FROM reel_saves) = 0, 'saves are private');
SELECT pg_temp.expect((SELECT count(*) FROM social_reports) = 0, 'reports are private');
SELECT pg_temp.expect((SELECT count(*) FROM reel_comments) = 1, 'a hidden comment is not shown');
SELECT set_config('app.user_id', 'u1', true);
SELECT pg_temp.expect((SELECT count(*) FROM reels) = 2, 'the author also sees their own pending reel');
SELECT set_config('app.user_id', 'u3', true);
SELECT pg_temp.expect((SELECT count(*) FROM reel_saves) = 1, 'a person sees their own saves');
SELECT pg_temp.expect((SELECT count(*) FROM social_reports) = 1, 'a reporter sees their own report');
SELECT pg_temp.expect((SELECT count(*) FROM reel_comments) = 2, 'a commenter sees their own hidden comment');
SELECT set_config('app.user_id', '', true);
DO $$ BEGIN
  INSERT INTO reels (id, author_id, company_id, mime_type, size_bytes, status, published_at, reviewed_by_id) VALUES ('rl-x', 'u3', 'co-a', 'video/mp4', 10, 'PUBLISHED', now(), 'u3');
  RAISE EXCEPTION 'FAIL: a reel published itself';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: only the platform publishes a reel'; END $$;
SELECT set_config('app.platform_admin', 'on', true);
DO $$ BEGIN
  INSERT INTO reels (id, author_id, company_id, mime_type, size_bytes) VALUES ('rl-big', 'u1', 'co-a', 'video/mp4', 99999999);
  RAISE EXCEPTION 'FAIL: oversize reel';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok: reels are limited to 4 MB'; END $$;
SELECT set_config('app.platform_admin', '', true);

SELECT 'ALL RLS CHECKS PASSED' AS result;
ROLLBACK;
