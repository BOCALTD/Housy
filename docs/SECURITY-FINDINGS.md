# Security findings, Phase 16

Method: read the code for each class of weakness, wrote an attack test for each, and fixed what the tests or the reading found. Tests marked (CI) ran only in CI against a real PostgreSQL 16 with the same restricted database role and row-level security the live app uses. Nobody outside this project has reviewed the code, and **no external penetration test has been done**.

## Defects found and fixed
| # | Finding | Severity | Fix | Proof |
|---|---|---|---|---|
| 1 | **Open redirect.** After sign-in and when saving a listing, the `next` address was accepted if it started with `/`, so `/\evil.example` or `//evil.example` could send a person to another site after they signed in. | High (phishing) | One helper, `safeLocalPath`, allows only same-site paths (rejects `//`, backslashes, control characters, absolute URLs, and anything over 500 characters). Used at every redirect built from input. | `tests/unit/security.test.ts` |
| 2 | **Header injection in downloads.** A file name from a user could contain quotes or line breaks and was placed in `Content-Disposition`. | Medium | `headerSafeFilename` strips everything except safe characters. Used by every download route. | unit test |
| 3 | **No Content-Security-Policy or HSTS.** | Medium | Added a CSP (no framing, no plugins, forms only to this site, scripts only from this site and Google sign-in for "Save to Drive"), HSTS for two years, `nosniff`, no framing, strict referrer policy. | unit test reads the config |
| 4 | **Permission check could fail open or throw** on an unknown action or role, and on names such as `constructor`. | Medium | `can()` answers *no* unless the action is in the table. | unit tests for `constructor`, `__proto__` |
| 5 | **Sign-in timing revealed whether an email had an account** (no password hash was computed for unknown emails). | Low | A dummy hash is checked so both paths take the same time. | code |
| 6 | **No way to recover an account, and no second step at sign-in.** | Gap | Password reset by one-time emailed link (hash stored, 60 minutes, 3 per hour per address and 10 per hour per visitor, same answer whether or not the account exists, signs out every device). Two-step sign-in with an authenticator app (secret encrypted at rest with AES-256-GCM, each code usable once, ten one-time recovery codes stored as hashes, rate-limited). | `phase16b` (CI) and unit tests |
| 8 | **Out-of-date web framework with published critical flaws.** The project pinned Next.js 14.2.15. Vercel's advisories list that line as affected by the React Server Components remote-code-execution flaw (CVE-2025-66478, "React2Shell") and by denial-of-service and source-exposure flaws (CVE-2025-55184, CVE-2025-67779, CVE-2025-55183). **Found in the final scan of Phase 16, after the release approval had said no critical defect was known; that statement was wrong.** | Critical | Upgraded to 14.2.35, the fixed version Vercel names for the 14.x line. Further 14.2.x patches may exist: check before launch. | CI builds and runs every test on the new version; no scan can prove the framework has no other flaws |
| 9 | **Next.js 14 still carried critical advisories** (denial of service through image optimisation and server components, request smuggling in rewrites), found by the new dependency audit in CI. | Critical | Upgraded to Next.js 16 and React 19 (async `params`, `searchParams`, `cookies`, `headers`); Playwright raised to 1.64. CI now runs `npm audit --omit=dev --audit-level=critical` on every push and fails on any critical advisory. | CI audit; full integration and device checks pass on the new versions |
| 7 | **Asset drop-downs stopped at 200** and the rent report drew every row. Not a security defect; both could make a page unusable for a large company. | Medium (availability) | Capped at 1,000 options ordered by reference; reports page 25 rows at a time. | performance test (CI) |

## Checked and found sound
Each of these has a test; none needed a code change.

- **Company isolation by identifier (IDOR).** A second company's administrator, using the real service functions, cannot read, change, create under, or upload to a first company's asset, lease, charge, receipt, work order or letter by identifier. Every attempt is refused with "not found", and the victim's records are unchanged afterwards. (`phase16a`, CI)
- **Row-level security on every table that holds company records**, probed three ways: as another company, as a signed-in person with no company, and as the public. Nothing is readable and nothing can be written. The test discovers the tables from the database itself, so a table added later is covered automatically. (`phase16a`, CI)
- **People and sign-in records** (users, sessions, resets, recovery codes) are not readable across accounts.
- **Role escalation.** A member cannot raise their own role; only the company administrator manages the team; a suspended member has no company to sign in to; the administrator cannot change their own role. Invitations work once, expire, and are bound to one email and one company.
- **Document and letter access.** Documents are released only to the roles allowed to download them; confidential letters only to roles allowed to see them and to the assignee.
- **Uploads** are checked by content (magic bytes), type and size, not by file name; a stored file is read back only by its own company.
- **Spreadsheet injection.** Cells beginning `=`, `+`, `-`, `@` are prefixed so a spreadsheet does not run them. The import tool's report is tested with a `=HYPERLINK(...)` name.
- **SQL.** A static test fails the build if raw SQL has input pasted into it. Hostile search text (`%`, `_`, quotes, `DROP TABLE`, 5,000 characters) is treated as text; the table is intact afterwards (CI).
- **Cookies** are HttpOnly; **every route** that returns data is checked by a static test for an identity check; every file with server actions is marked as such; no page injects raw HTML.
- **Webhook replay and duplication** for payments and email unsubscribe forgery are covered by earlier phases' tests (`phase14a`, `phase13a`) and still pass.
- **Concurrency.** Many payments at once never over-apply a charge or lose a kobo (`phase16c`, CI); two people cannot use one two-step code at the same moment.

## Open, in order of importance
1. **Two-step sign-in is available but not required**, including for platform administrators, who can see and change the most. The admin page shows a banner until the administrator turns it on. Make it mandatory for platform admins before real companies are onboarded. (Medium)
2. **The two-step encryption key falls back to the database password** when `MFA_ENCRYPTION_KEY` is not set. Set `MFA_ENCRYPTION_KEY` to its own random 32-byte value in production. Until then, changing the database password would make existing two-step secrets unreadable. (Medium)
3. **Password-reset email needs an email provider.** None is connected. Until one is, a reset link is queued but not delivered. (Blocks account recovery in production)
4. **The CSP allows inline scripts and styles** (`'unsafe-inline'`), because Next.js inlines its bootstrap script. A nonce-based policy would be stricter. (Low)
5. **Passwords** are checked for length only; there is no breached-password list. (Low)
6. **Rate limits are per address and per visitor**, held in the database. They stop casual abuse. They are not a defence against a distributed attack; put the site behind the host's firewall or a CDN with bot protection. (Low until launch)
7. **No dependency audit in the build, and no committed lockfile**, so which versions are installed can change from one build to the next. Finding 8 is what that gap hides. Run `npm audit`, commit `package-lock.json`, and add an audit step. (Unknown, but demonstrated once)
8. **No external review.** See above.

# Launch audit, 30 October 2026

Method: a sweep of every route, every server action, the database's row-level security (checked against a database built from all migrations), uploads, redirects, outbound requests, secrets in the repository, headers, cookies, rate limits, webhooks and the newest features (accounts by type, reels and music, offline field kit, suggestions, accounting export, loader and welcome slides). CI then ran the full unit, integration, smoke and device checks (over 200 pages on 7 devices). Still no external penetration test.

## Fixed in this audit
| # | Finding | Severity | Fix |
|---|---|---|---|
| 10 | **Redirect after an action could leave the site.** Seven actions took a `back` field from the form and redirected to it unchecked. Next.js already refuses server actions from other sites, so only a person editing their own form could trigger it, but the rule was not enforced in one place. | Low | `act()` now sends people only to paths on this site or to the payment provider's checkout (`safeTarget` in `src/lib/forms.ts`). |
| 11 | **No robots.txt or sitemap.** Search engines could index private pages such as `/app` and `/admin` login screens, and could not find public listings efficiently. | Medium (launch) | `robots.ts` keeps private areas, one-off links and API out of search; `sitemap.ts` lists the public pages, published properties, listed agents and companies, reels and market pages. Smoke test checks both. |
| 12 | **The lockfile was never saved.** The CI step that keeps `package-lock.json` ran after the device-screenshot step had emptied the working folder, so nothing was kept (open item 7). | Medium | The lockfile is saved straight after install; commit it from the CI artifact so every build installs the same versions. |
| 13 | **A map test could fail by chance** when a random position fell on the blurring grid. Not a product defect. | Test | The test position is placed off the grid. |
| 14 | **Inline loader script.** The opening loader first used an inline script, which the project's own rule forbids (no injected HTML). | Low | Moved to `public/boot.js`; it only switches classes on `<html>`. |

## Checked and found sound
- Every route answers only after checking who is asking, or is on the reviewed public list with its reason (static test). Every server action checks the person through `requireUser`, `requireMember`, `requirePlatformAdmin`, `currentActor`, or a one-time token.
- Row-level security is on for every table that holds company, person or social records. Seven social tables (agent and company profiles, conversations and members, flatmate profiles and requests, blocks) have it on but not *forced*; that only matters for the table owner, and the app connects as `estate_app`, which is not the owner and cannot bypass it. Tables without it hold sign-in machinery (users, sessions, resets, recovery codes, sign-in locks, rate limits) or platform data (service providers and their leads, the verification-prompt counter, the nearby-places cache) and are reached only through server code.
- The app's database role cannot change or delete the audit trail or financial records (append-only grants).
- Uploads: content-checked and size-capped everywhere (documents, photos, KYC, evidence, vacancy photos, collaboration files, reels, music); SVG and HTML are never accepted.
- Outbound requests go only to fixed providers (payments, email, identity checks, AI, maps); push endpoints are limited to the browser vendors' push services, so the server cannot be pointed at internal addresses.
- Webhooks are verified by HMAC signature; scheduled jobs by a secret compared in constant time; nginx overwrites `X-Forwarded-For`, so rate limits cannot be dodged by forging it.
- No secrets in the repository; `.env` files are ignored.
- New features: offline field sync accepts same-origin requests only and re-checks the inspector on arrival; suggestions history is readable only by its owner (row-level security) and can be cleared or turned off; reels actions answer "sign in" to visitors; music tracks require a recorded licence and only the platform administrator can add them.

## Still open before launch (owner's actions)
1. Set the production secrets and keys (see `/admin/launch`): `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_PLATFORM_NAME`, `MFA_ENCRYPTION_KEY`, `REQUIRE_ADMIN_MFA=true`, `CRON_SECRET`, `UNSUBSCRIBE_SECRET`, Resend, Paystack (live), MapTiler, Dojah or Youverify.
2. Do not run `db:seed:demo` on the live database; replace the demo music with licensed tracks.
3. ~~Commit `package-lock.json`~~ Done: the lockfile CI resolved and tested is committed (Next.js 16.4.2, React 19.2.0, zod 4.6.7).
4. Commission an external penetration test once the site runs on its real domain.
5. Put the site behind a CDN or firewall with bot protection for distributed attacks.
