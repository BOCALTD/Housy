/**
 * Is this deployment ready for real customers? Looks only at which settings exist and whether they look sane. It never returns a
 * secret's value, and it never contacts any outside service, so a "ready" answer means "configured", not "proven to work".
 */
export type Env = Record<string, string | undefined>;
export type Level = "ok" | "warn" | "fail";
export interface ReadinessCheck { id: string; label: string; level: Level; detail: string; owner: "you" | "hosting" | "provider" }

const has = (v: string | undefined) => !!v && v.trim() !== "";
const long = (v: string | undefined, n: number) => has(v) && v!.trim().length >= n;
const PLACEHOLDER = /CHANGE_ME|changeme|example\.com|^\[.*\]$/i;

export function readinessChecks(env: Env): ReadinessCheck[] {
  const prod = env.NODE_ENV === "production";
  const out: ReadinessCheck[] = [];
  const add = (id: string, label: string, level: Level, detail: string, owner: ReadinessCheck["owner"] = "you") => out.push({ id, label, level, detail, owner });

  const dbUrl = env.DATABASE_URL ?? "";
  if (!has(dbUrl)) add("database", "Database connection", "fail", "DATABASE_URL is not set.", "hosting");
  else if (PLACEHOLDER.test(dbUrl)) add("database", "Database connection", "fail", "DATABASE_URL still holds the example value.", "hosting");
  else add("database", "Database connection", "ok", "A database address is set.", "hosting");

  add("app-password", "Restricted database password", long(env.APP_DB_PASSWORD, 24) && !PLACEHOLDER.test(env.APP_DB_PASSWORD!) ? "ok" : "fail",
    long(env.APP_DB_PASSWORD, 24) ? "Set (24 or more characters)." : "APP_DB_PASSWORD must be random and at least 24 characters, or row-level security cannot be set up.", "hosting");

  add("mfa-key", "Two-step secret encryption key", long(env.MFA_ENCRYPTION_KEY, 32) ? "ok" : prod ? "fail" : "warn",
    long(env.MFA_ENCRYPTION_KEY, 32) ? "Set to its own value." : "MFA_ENCRYPTION_KEY is missing or short (use 32 or more random characters). Without it the database password is used, so changing that password would lock out everyone with two-step on.");

  add("admin-mfa", "Two-step sign-in required for platform administrators", env.REQUIRE_ADMIN_MFA === "true" ? "ok" : "fail",
    env.REQUIRE_ADMIN_MFA === "true" ? "Required." : "Set REQUIRE_ADMIN_MFA=true. Until then a platform administrator can work without it.");

  add("setup-token", "First-administrator setup token", long(env.SETUP_TOKEN, 24) && !PLACEHOLDER.test(env.SETUP_TOKEN!) ? "ok" : "warn",
    long(env.SETUP_TOKEN, 24) ? "Set. After the first administrator exists the setup page is closed; remove the token." : "SETUP_TOKEN is missing or short; the setup page cannot be used safely.");

  const url = env.NEXT_PUBLIC_APP_URL ?? "";
  add("app-url", "Public web address", /^https:\/\//.test(url) ? "ok" : has(url) ? (prod ? "fail" : "warn") : "warn",
    /^https:\/\//.test(url) ? "HTTPS address set." : has(url) ? "The address is not HTTPS." : "NEXT_PUBLIC_APP_URL is not set; links in email will use a guess.", "hosting");

  add("brand", "Product name", has(env.NEXT_PUBLIC_PLATFORM_NAME) && !PLACEHOLDER.test(env.NEXT_PUBLIC_PLATFORM_NAME!) ? "ok" : "warn",
    has(env.NEXT_PUBLIC_PLATFORM_NAME) && !PLACEHOLDER.test(env.NEXT_PUBLIC_PLATFORM_NAME!) ? "Set." : "NEXT_PUBLIC_PLATFORM_NAME still holds the placeholder.");

  add("email", "Email provider", has(env.RESEND_API_KEY) && has(env.EMAIL_FROM) ? "ok" : "fail",
    has(env.RESEND_API_KEY) && has(env.EMAIL_FROM) ? "Key and sender address set. Send one real test message before launch." : "RESEND_API_KEY and EMAIL_FROM are both needed. Without them no email is delivered, including password resets.", "provider");

  const pk = env.PAYSTACK_SECRET_KEY ?? "";
  add("payments", "Payment provider", /^sk_live_/.test(pk) ? "ok" : /^sk_test_/.test(pk) ? "warn" : "warn",
    /^sk_live_/.test(pk) ? "A live key is set. Prove it with one small real payment." : /^sk_test_/.test(pk) ? "A TEST key is set: no real money moves." : "No key: payments stay manual (bank transfer recorded by hand).", "provider");

  add("cron", "Scheduled-job secret", long(env.CRON_SECRET, 24) ? "ok" : "fail",
    long(env.CRON_SECRET, 24) ? "Set." : "CRON_SECRET is missing or short. Reminders, renewals, email sending and the detailed health report will not run.", "hosting");

  add("unsubscribe", "Unsubscribe-link secret", long(env.UNSUBSCRIBE_SECRET, 24) ? "ok" : "warn",
    long(env.UNSUBSCRIBE_SECRET, 24) ? "Set." : "UNSUBSCRIBE_SECRET is not set, so the database password signs unsubscribe links. Set a separate one.");

  add("demo-data", "No demonstration data", env.SEED_DEMO_DATA === "true" ? (prod ? "fail" : "warn") : "ok",
    env.SEED_DEMO_DATA === "true" ? "SEED_DEMO_DATA is true: sample companies would be created. Turn it off for production." : "Off.");

  add("support", "Support contact shown to users", has(env.SUPPORT_EMAIL) ? "ok" : "warn",
    has(env.SUPPORT_EMAIL) ? "Set." : "SUPPORT_EMAIL is not set, so the support page has no address to show.");

  add("ai", "Assistant (optional)", has(env.ANTHROPIC_API_KEY) ? "ok" : "ok",
    has(env.ANTHROPIC_API_KEY) ? "Connected." : "Not connected. The assistant runs on its built-in rules, which is fine.");

  return out;
}

export function readinessSummary(checks: ReadinessCheck[]) {
  const fail = checks.filter((c) => c.level === "fail").length, warn = checks.filter((c) => c.level === "warn").length;
  return { fail, warn, ok: checks.length - fail - warn, ready: fail === 0 };
}

/** True when the deployment requires two-step sign-in for platform administrators and this one has not turned it on. */
export function adminMfaMissing(env: Env, user: { mfaEnabledAt?: Date | null }) {
  return env.REQUIRE_ADMIN_MFA === "true" && !user.mfaEnabledAt;
}
