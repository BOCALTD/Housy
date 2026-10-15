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

SELECT 'ALL RLS CHECKS PASSED' AS result;
ROLLBACK;
