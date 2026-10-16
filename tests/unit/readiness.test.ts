import test from "node:test";
import assert from "node:assert/strict";
import { adminMfaMissing, readinessChecks, readinessSummary } from "../../src/lib/readiness";

const good = {
  NODE_ENV: "production", DATABASE_URL: "postgresql://u:p@127.0.0.1/estate", APP_DB_PASSWORD: "a".repeat(30), MFA_ENCRYPTION_KEY: "m".repeat(40),
  REQUIRE_ADMIN_MFA: "true", SETUP_TOKEN: "s".repeat(30), NEXT_PUBLIC_APP_URL: "https://housy.example.ng", NEXT_PUBLIC_PLATFORM_NAME: "Housy",
  RESEND_API_KEY: "re_x", EMAIL_FROM: "Housy <no-reply@housy.ng>", PAYSTACK_SECRET_KEY: "sk_live_abc", CRON_SECRET: "c".repeat(30), UNSUBSCRIBE_SECRET: "u".repeat(30), SUPPORT_EMAIL: "help@housy.ng",
};
const by = (env: Record<string, string | undefined>) => Object.fromEntries(readinessChecks(env).map((c) => [c.id, c]));

test("a fully configured production deployment has no blockers and no warnings", () => {
  const s = readinessSummary(readinessChecks(good));
  assert.deepEqual(s, { fail: 0, warn: 0, ok: readinessChecks(good).length, ready: true });
});

test("an empty deployment is not ready, and says why", () => {
  const c = by({});
  for (const id of ["database", "app-password", "admin-mfa", "email", "cron"]) assert.equal(c[id].level, "fail", id);
  assert.equal(readinessSummary(readinessChecks({})).ready, false);
});

test("example values are not accepted in production", () => {
  assert.equal(by({ ...good, DATABASE_URL: "postgresql://estate_owner:CHANGE_ME@host/estate" }).database.level, "fail");
  assert.equal(by({ ...good, DATABASE_URL: "postgresql://u:p@localhost:5432/estate" }).database.level, "ok"); // the Ubuntu setup keeps PostgreSQL on the same machine
  assert.equal(by({ ...good, NEXT_PUBLIC_APP_URL: "http://housy.ng" }).database.level, "ok");
  assert.equal(by({ ...good, NEXT_PUBLIC_APP_URL: "http://housy.ng" })["app-url"].level, "fail");
  assert.equal(by({ ...good, NEXT_PUBLIC_PLATFORM_NAME: "[Platform Name]" }).brand.level, "warn");
  assert.equal(by({ ...good, SEED_DEMO_DATA: "true" })["demo-data"].level, "fail");
});

test("payments: live is ready, test mode and none are flagged", () => {
  assert.equal(by(good).payments.level, "ok");
  assert.equal(by({ ...good, PAYSTACK_SECRET_KEY: "sk_test_abc" }).payments.level, "warn");
  assert.equal(by({ ...good, PAYSTACK_SECRET_KEY: undefined }).payments.level, "warn");
});

test("short secrets are refused and no value is ever shown", () => {
  assert.equal(by({ ...good, CRON_SECRET: "short" }).cron.level, "fail");
  assert.equal(by({ ...good, MFA_ENCRYPTION_KEY: "short" })["mfa-key"].level, "fail");
  assert.equal(by({ ...good, REQUIRE_ADMIN_MFA: "false" })["admin-mfa"].level, "fail");
  const text = JSON.stringify(readinessChecks(good));
  for (const secret of [good.APP_DB_PASSWORD, good.MFA_ENCRYPTION_KEY, good.CRON_SECRET, good.PAYSTACK_SECRET_KEY, good.RESEND_API_KEY, good.SETUP_TOKEN, good.DATABASE_URL]) assert.ok(!text.includes(secret), "a secret leaked into the report");
});

test("when required, an administrator without two-step sign-in is held back; otherwise nobody is", () => {
  assert.equal(adminMfaMissing({ REQUIRE_ADMIN_MFA: "true" }, { mfaEnabledAt: null }), true);
  assert.equal(adminMfaMissing({ REQUIRE_ADMIN_MFA: "true" }, {}), true);
  assert.equal(adminMfaMissing({ REQUIRE_ADMIN_MFA: "true" }, { mfaEnabledAt: new Date() }), false);
  assert.equal(adminMfaMissing({}, { mfaEnabledAt: null }), false);
  assert.equal(adminMfaMissing({ REQUIRE_ADMIN_MFA: "TRUE" }, { mfaEnabledAt: null }), false, "only the exact word true turns it on, and the readiness page then shows it as not set");
});
