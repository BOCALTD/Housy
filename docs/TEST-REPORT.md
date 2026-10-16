# Test report, Phase 16

Everything runs on every push in GitHub Actions (`.github/workflows/ci.yml`): migrations are applied as `deploy.sh` does on the server, then type check, unit tests, integration tests against a real PostgreSQL 16 using the restricted app role with row-level security, a backup-and-restore check, a production build, a smoke test of the running app, and a device check in desktop Chrome and emulated iPhone, Android and tablet browsers.

**Totals:** see the CI summary of the release commit ("Test totals" notices). At the time of writing: 194 unit tests and 305 integration tests, all passing; the device check opened 133 distinct pages on 7 browser profiles (desktop Chrome, desktop Safari, two iPhones, two Androids, an iPad) and, after the fixes listed under SECURITY-FINDINGS and below, found nothing. The backup check dumped a 3.6 MB database (183 tables, 92,476 rows) in 1.0 s and restored it in 2.6 s with every table, security setting and money total identical.

## Coverage against the Phase 16 work list

| # | Work item | What proves it | Where |
|---|---|---|---|
| 1 | Unit tests | Pure rules for rent, ledger, service charges, commissions, valuation, rewards, notifications, subscriptions, security helpers, import rules | `tests/unit/*.test.ts` |
| 2 | Integration tests | Every service against a real database, as each role | `tests/integration/phase*.test.ts` |
| 3 | End-to-end journeys | Each earlier phase has an acceptance test that walks the journey through the service layer (`phase7-acceptance`, `phase8-acceptance`, `phase9-acceptance`, `phase10-acceptance`, …); the smoke test then opens every signed-in page of a seeded company as administrator and as officer, and every public page. **Not covered:** a scripted browser clicking through a complete journey (for example sign up → add asset → lease → record payment). The device check loads pages; it does not submit forms. | acceptance tests, `scripts/smoke.sh` |
| 4 | Tenant isolation, IDOR, role escalation, document access | Attack tests as another company, a signed-in stranger and the public, on every table the database reports as company-owned; by-identifier attacks through every main service; role escalation; invitations; document and confidential-letter access | `phase16a`, `tests/sql` (row-level security, run as the app role), `tests/unit/security.test.ts` |
| 5 | Common vulnerabilities, secure files | Open redirect, header injection, spreadsheet injection, upload content checks, SQL pasted into queries, cookie flags, security headers, route identity checks | `security.test.ts`, `phase16a` |
| 6 | Independent validation of calculations | See below | `oracle.test.ts`, `phase16c`, `zz2-books` |
| 7 | Notification failures, webhook duplication, retries | Email retried with delays, gives up after five tries, retried by an administrator, unrecoverable refusals go straight to the dead list; duplicate runs cannot send twice; payment messages that are repeated, concurrent, unsigned, altered, wrong amount or wrong currency | `phase13a`, `phase14a` |
| 8 | Performance | See `PERFORMANCE.md` | `zz1-performance` |
| 9 | Mobile layouts, keyboard, accessibility, reduced motion | Device check on every page: no sideways scroll, touch targets ≥ 44 px, text ≥ 12 px and form text ≥ 16 px on phones, labels on fields, alt text, page language, one main heading, a main region, names on every link and button, no duplicate ids, skip link, keyboard Tab order with visible focus, no keyboard trap, animations stop when reduced motion is requested | `scripts/device-check.ts` |
| 10 | Backups, recovery, monitoring, incident response | Backup-and-restore check in CI; runbook; health endpoint with operator detail | `scripts/backup-restore-check.sh`, `RUNBOOK.md`, `/api/health` |
| 11 | Migrate approved data with reconciliation and duplicate detection | Import tool with preview, duplicate detection, per-line outcomes and reconciliation | `phase16d`, `import-rules.test.ts`, `MIGRATION.md` |
| 12 | Resolve critical and high defects | `SECURITY-FINDINGS.md` | |

## Independent validation of calculations (item 6)
"Independent" means the expected answer is computed by a different route from the product code, so a mistake in one is not repeated in the other.

| Calculation | Product code | Independent check |
|---|---|---|
| Rent schedules | `generateRentSchedule` | Calendar count by day of month with month ends and leap years, for 3,000 random leases; a schedule worked by hand |
| Charge status, days overdue | `rent.ts` | Day-by-day counting for 5,000 random charges |
| Payment allocation | `allocatePayment` | Never exceeds what is owed; oldest first; to the kobo for 3,000 random ledgers |
| Whole ledger | real database | A random run of payments, reversals, late fees, waivers and refused requests (three seeds, 45 steps each) is applied to a real lease and to a small model written separately; after every step they agree to the kobo and the ledger's own consistency check finds nothing |
| Concurrent payments | row locks | Many payments at once never over-apply a charge or lose a kobo |
| Service charge shares | budget split | Each share is the exact fraction rounded down or up and nothing is lost or invented |
| Commission | percentage and split | Exact percentage rounded half-up; a split loses and invents no kobo |
| Valuation | income, cost, sales comparison | Within the rounding each method states, against exact arithmetic |
| Rewards | state table | Allowed paths only; paid is final; every state can reach an end; money paid out equals rewards marked paid (`zz2-books`) |
| Platform books | finance ledger | After the whole suite the platform books balance (`zz2-books`) |
| Money text | parse and format | Round-trips for 3,000 random amounts without floating point |
| Import | file totals | Rent scheduled, paid and owed in the file equal the database after import (`phase16d`) |

**Taxes.** The product tracks tax obligations (land use charge, withholding tax, stamp duty and similar) as dated obligations with amounts and filings that people enter. It does not compute any tax, so there was no tax calculation to validate. Tax rates and rules for Nigerian property are the owner's decision with an accountant; none should be added without a specification and an independent check like the ones above.

## What the new accessibility checks found
There was no skip-to-content link anywhere, so one was added before the checks first ran. On their first run the checks then found six pages with no main heading (account home, sign-in security, two advertising pages, an advertising detail page, and a reel page); all now have one. They also flagged the calendar button of date fields as having no focus mark; that was the check being wrong (the browser reports the field, not its inner button), and it now skips date fields. Keyboard order, visible focus, language, names on controls, repeated ids and reduced motion found nothing across the 133 pages.

## What these tests do not show
- **Whole journeys in a browser.** Services are tested directly and pages are loaded, but no script clicks through "sign up, add an asset, create a lease, record a payment" in a browser.
- **Real devices.** All phone and tablet results are from emulated browsers (Chrome and WebKit engines at phone sizes). Nobody has used it on a real handset, on a real mobile network, or with a screen reader.
- **Screen readers and contrast.** The checks look for names, labels, headings and focus; they do not run a screen reader and they do not measure colour contrast.
- **Email and payment providers.** Both are tested with fakes only. No real email has been sent; no real Paystack message has been received.
- **Load.** No test with many simultaneous visitors.
- **Real data.** All tests use generated data.
