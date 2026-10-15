// Prepare the database before each deploy (Vercel runs this through `npm run vercel-build`).
//  1. Create or update the restricted runtime role "estate_app" (no superuser, cannot bypass row-level security).
//  2. Apply pending migrations as the database owner.
//  3. Grant the runtime role access to every table, keeping the audit log and payments append-only.
//
// Environment:
//  - MIGRATION_DATABASE_URL, or the owner connection a Neon / Vercel Postgres integration provides
//    (DATABASE_URL_UNPOOLED or POSTGRES_URL_NON_POOLING). Must be a direct, non-pooled connection.
//  - APP_DB_PASSWORD: password for estate_app, at least 24 characters.
import { execFileSync } from "node:child_process";

const ownerUrl =
  process.env.MIGRATION_DATABASE_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING;
const appPassword = process.env.APP_DB_PASSWORD ?? "";

function fail(message) {
  console.error(`\ndb-setup: ${message}\n`);
  process.exit(1);
}

if (!ownerUrl) fail("No owner database connection. Connect a Postgres database (Neon) to the project, or set MIGRATION_DATABASE_URL.");
if (appPassword.length < 24) fail("Set APP_DB_PASSWORD to a random password of at least 24 characters.");
if (/['\\]/.test(appPassword)) fail("APP_DB_PASSWORD must not contain quotes or backslashes.");

function execSql(sql, label) {
  console.log(`db-setup: ${label}`);
  execFileSync("npx", ["prisma", "db", "execute", "--stdin", "--url", ownerUrl], { input: sql, stdio: ["pipe", "inherit", "inherit"] });
}

execSql(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'estate_app') THEN
    CREATE ROLE estate_app LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOBYPASSRLS;
  ELSE
    ALTER ROLE estate_app WITH LOGIN PASSWORD '${appPassword}';
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO estate_app', current_database());
END $$;
`, "runtime role ready");

console.log("db-setup: applying migrations");
execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: ownerUrl }, stdio: "inherit" });

// Tables the application may add to but never change or delete: the audit trail and financial records.
const APPEND_ONLY = [
  "activity_log", "correspondence_actions",
  "rent_payments", "receipts", "receipt_reconciliations", "receipt_reversals", "deposit_entries",
  "lease_notices", "lease_handovers", "service_collections", "service_collection_reversals", "obligation_filings", "evidence_photos", "work_order_events", "inventory_movements", "project_forecasts", "project_stock_uses", "site_inspections", "progress_updates", "project_documents",
];

execSql(`
GRANT USAGE ON SCHEMA public TO estate_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO estate_app;
${APPEND_ONLY.map((t) => `REVOKE UPDATE, DELETE ON ${t} FROM estate_app;`).join("\n")}
REVOKE ALL ON _prisma_migrations FROM estate_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO estate_app;
`, "runtime role privileges granted");

console.log("db-setup: done");
