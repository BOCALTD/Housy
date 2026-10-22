import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { safeLocalPath, headerSafeFilename } from "../../src/lib/security";
import { validateUpload, MAX_UPLOAD_BYTES } from "../../src/lib/storage";
import { csvCell } from "../../src/lib/csv";
import { base32Encode, codeFor, verifyCode, sealSecret, openSecret, newSecret, hashRecovery, normaliseRecovery, newRecoveryCodes } from "../../src/lib/totp";
import { can, ALL_ROLES, type Action, type Role } from "../../src/lib/permissions";

const SRC = join(__dirname, "../../src");
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p, out); else out.push(p); }
  return out;
}
const files = walk(SRC);

// ---- redirects ----
test("only same-site paths are accepted for redirects", () => {
  for (const ok of ["/app", "/app/leases/abc?x=1", "/properties/HSY-1#top"]) assert.equal(safeLocalPath(ok, "/"), ok);
  for (const bad of ["//evil.com", "/\\evil.com", "/\\/evil.com", "https://evil.com", "javascript:alert(1)", "evil.com", "", "/a\nb", "/a\r\nSet-Cookie: x=1", "/\u0000", " //evil.com", "/%5Cevil.com/../..//x".replace("/%5C", "/\\")]) {
    assert.equal(safeLocalPath(bad, "/fallback"), "/fallback", JSON.stringify(bad));
  }
  assert.equal(safeLocalPath(undefined, "/f"), "/f");
  assert.equal(safeLocalPath("/" + "a".repeat(600), "/f"), "/f");
});

test("download file names cannot break a header", () => {
  for (const n of ['a"b.pdf', "a\r\nX-Evil: 1.pdf", "../../etc/passwd", "é.pdf", ""]) {
    const s = headerSafeFilename(n);
    assert.match(s, /^[\w.\- ]+$/);
    assert.ok(!s.includes("..") || !s.startsWith("."), s);
  }
  assert.equal(headerSafeFilename("", "campaign"), "campaign");
  assert.equal(headerSafeFilename("....."), "download");
});

// ---- uploads ----
const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0]);
test("uploads are checked by type, contents and size", () => {
  validateUpload("application/pdf", bytes(0x25, 0x50, 0x44, 0x46));
  validateUpload("image/png", bytes(0x89, 0x50, 0x4e, 0x47));
  assert.throws(() => validateUpload("image/png", bytes(0x25, 0x50, 0x44, 0x46)), /do not match/); // a PDF renamed as a picture
  assert.throws(() => validateUpload("application/pdf", bytes(0x4d, 0x5a)), /do not match/); // a Windows program
  for (const t of ["text/html", "image/svg+xml", "application/x-msdownload", "application/javascript", "application/zip", ""]) {
    assert.throws(() => validateUpload(t, bytes(0x25, 0x50, 0x44, 0x46)), /Upload a PDF/, t);
  }
  assert.throws(() => validateUpload("application/pdf", new Uint8Array(0)), /empty/);
  const big = new Uint8Array(MAX_UPLOAD_BYTES + 1); big.set([0x25, 0x50, 0x44, 0x46]);
  assert.throws(() => validateUpload("application/pdf", big), /4 MB/);
});

// ---- spreadsheet injection ----
test("spreadsheet cells never start a formula", () => {
  for (const evil of ["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "\t=1", "\r=1"]) {
    assert.ok(csvCell(evil).replace(/^"/, "").startsWith("'"), evil);
  }
  assert.equal(csvCell("normal"), "normal");
  assert.equal(csvCell(-5), "-5"); // real numbers are not text
});

// ---- two-step sign-in ----
test("one-time codes follow RFC 6238 and work once", () => {
  const rfc = base32Encode(Buffer.from("12345678901234567890"));
  assert.equal(codeFor(rfc, 1, 8), "94287082");
  assert.equal(codeFor(rfc, 37037036, 8), "07081804");
  assert.equal(codeFor(rfc, 37037037, 8), "14050471");
  const s = newSecret(), step = 55_000_000, t = step * 30_000 + 5_000;
  assert.equal(verifyCode(s, codeFor(s, step), t, null), step);
  assert.equal(verifyCode(s, codeFor(s, step - 1), t, null), step - 1); // clock a little slow
  assert.equal(verifyCode(s, codeFor(s, step + 1), t, null), step + 1); // clock a little fast
  assert.equal(verifyCode(s, codeFor(s, step - 2), t, null), null);   // too old
  assert.equal(verifyCode(s, codeFor(s, step), t, step), null);        // replay
  assert.equal(verifyCode(s, codeFor(s, step + 1), t, step), step + 1); // a later step is fine
  for (const junk of ["", "12345", "1234567", "abcdef", "12 34 5"]) assert.equal(verifyCode(s, junk, t, null), null, junk);
  assert.equal(verifyCode(s, ` ${codeFor(s, step).slice(0, 3)} ${codeFor(s, step).slice(3)} `, t, null), step); // spaces are fine
});

test("the stored secret is encrypted and tamper-evident", () => {
  const s = newSecret(), env = { MFA_ENCRYPTION_KEY: "k1" };
  const sealed = sealSecret(s, env);
  assert.ok(!sealed.includes(s));
  assert.equal(openSecret(sealed, env), s);
  assert.throws(() => openSecret(sealed, { MFA_ENCRYPTION_KEY: "other" }));
  const parts = sealed.split("."); parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("AA") ? "BB" : "AA");
  assert.throws(() => openSecret(parts.join("."), env));
  assert.notEqual(sealSecret(s, env), sealed); // fresh nonce each time
});

test("recovery codes are unique, typed forgivingly and stored only as hashes", () => {
  const codes = newRecoveryCodes();
  assert.equal(new Set(codes).size, 10);
  for (const c of codes) { assert.match(c, /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/); assert.equal(hashRecovery(c), hashRecovery(c.toUpperCase().replace(/-/g, " "))); assert.equal(normaliseRecovery(c).length, 12); }
  assert.notEqual(hashRecovery(codes[0]), hashRecovery(codes[1]));
});

// ---- permissions ----
const perm = readFileSync(join(SRC, "lib/permissions.ts"), "utf8");
const rows = [...perm.matchAll(/^\s*"([a-z.]+)":\s*\[(.*?)\]/gm)].map((m) => ({ action: m[1] as Action, roles: [...m[2].matchAll(/"([A-Z_]+)"/g)].map((r) => r[1] as Role) }));
const declared = [...perm.matchAll(/^\s*\| "([a-z.]+)"/gm)].map((m) => m[1]);

test("every action has exactly one row in the permission table", () => {
  assert.deepEqual([...declared].sort(), rows.map((r) => r.action).sort());
  assert.equal(new Set(declared).size, declared.length);
});

test("permission invariants hold for every action", () => {
  for (const r of rows) {
    for (const role of ALL_ROLES) assert.equal(can(role, r.action), r.roles.includes(role), `${role} ${r.action}`);
    assert.ok(can("COMPANY_SUPER_ADMIN", r.action), `super admin lacks ${r.action}`);
    if (can("VIEWER", r.action)) assert.match(r.action, /\.view$/, `viewer may do ${r.action}`); // viewers only look
    if (can("AGENT", r.action)) assert.ok(!/(approve|reverse|settle|reconcile|team|billing|settings|audit)/.test(r.action), `agent may ${r.action}`);
  }
  for (const a of ["billing.manage", "ai.audit", "team.manage", "settings.manage", "api.manage", "kyc.manage"] as Action[]) {
    assert.deepEqual(ALL_ROLES.filter((r) => can(r, a)), ["COMPANY_SUPER_ADMIN"], a);
  }
  assert.equal(can("MANAGER" as Role, "nonexistent.action" as Action), false);
  assert.equal(can("NOT_A_ROLE" as Role, "asset.view"), false);
  assert.equal(can("MANAGER", "constructor" as Action), false);
  assert.equal(can("MANAGER", "__proto__" as Action), false);
});

// ---- static checks on the code ----
test("no route hands out data without checking who is asking", () => {
  const PUBLIC_BY_DESIGN: Record<string, string> = {
    "app/r/[code]/route.ts": "referral link: counts a visit and redirects to a fixed page",
    "app/ads/click/[ref]/route.ts": "an advert click: the service decides whether to charge; the visitor always reaches the property",
    "app/api/webhooks/paystack/route.ts": "verified by the provider's signature",
    "app/reels/[id]/video/route.ts": "the service returns only clips the viewer may see",
    "app/api/v1/listings/route.ts": "published listings only; read-only; rate limited",
    "app/api/v1/listings/[ref]/route.ts": "one published listing; read-only; rate limited",
    "app/api/v1/openapi/route.ts": "the public description of the API",
    "app/calendar/[token]/route.ts": "a private calendar feed: the secret in the link is the key (stored as a hash, replaceable, rate limited)",
    "app/partners/[id]/logo/route.ts": "logos of active partners only; the database hides the rest",
    "app/photos/[id]/route.ts": "pictures of published listings; the database returns nothing for any other listing",
  };
  const AUTH = /scope: "|getMember|getSession|requireUser|requireMember|requirePlatformAdmin|cronAuthorised|signature/;
  for (const f of files.filter((f) => f.endsWith("/route.ts"))) {
    const rel = f.slice(SRC.length + 1);
    if (rel === "app/api/health/route.ts") continue; // up/down only; details need the cron secret
    if (PUBLIC_BY_DESIGN[rel]) continue;
    assert.match(readFileSync(f, "utf8"), AUTH, `${rel} does not check who is asking`);
  }
});

test("every file that exports server actions is marked as such, and no page injects raw HTML", () => {
  for (const f of files.filter((f) => /\/actions\.ts$|auth-actions\.ts$/.test(f))) {
    assert.match(readFileSync(f, "utf8").slice(0, 40), /^"use server"/, f);
  }
  for (const f of files.filter((f) => /\.(ts|tsx)$/.test(f))) {
    const t = readFileSync(f, "utf8");
    assert.ok(!t.includes("dangerouslySetInnerHTML"), `${f} injects raw HTML`);
    assert.ok(!/\beval\(|new Function\(/.test(t), `${f} evaluates text as code`);
  }
});

test("raw SQL never has input pasted into it", () => {
  for (const f of files.filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))) {
    const t = readFileSync(f, "utf8");
    for (const m of t.matchAll(/\$(?:query|execute)RawUnsafe[^(]*\(\s*`([^`]*)`/g)) {
      for (const hole of m[1].matchAll(/\$\{([^}]*)\}/g)) {
        assert.equal(hole[1].trim(), "table", `${f}: only a fixed table name may be pasted into SQL, found \${${hole[1]}}`);
      }
    }
    assert.ok(!/\$(?:query|execute)RawUnsafe\(\s*[a-zA-Z_]/.test(t), `${f}: raw SQL built from a variable`);
  }
});

test("session and reset cookies are not readable by scripts", () => {
  const auth = readFileSync(join(SRC, "lib/auth.ts"), "utf8");
  assert.match(auth, /httpOnly: true/);
  assert.match(auth, /sameSite: "lax"/);
  assert.match(auth, /secure: process\.env\.NODE_ENV === "production"/);
});

test("security headers are set for every page", () => {
  const cfg = readFileSync(join(SRC, "../next.config.mjs"), "utf8");
  for (const h of ["Content-Security-Policy", "Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy"]) assert.ok(cfg.includes(h), h);
  assert.match(cfg, /frame-ancestors 'none'/);
  assert.match(cfg, /object-src 'none'/);
  assert.match(cfg, /geolocation=\(self\)/); // the map's "use my location" needs it
});
