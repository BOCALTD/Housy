# Release approval, Phase 16

**Recommendation: ready for a closed pilot with the conditions in section 3. Not ready for open registration, real payments, or real customers' money until the section 2 items are done.** This is the engineer's assessment from what was built and tested. It is not an independent audit and it is not a sign-off by the business owner; the owner decides.

## 1. Acceptance criteria

| Criterion | Result | Evidence |
|---|---|---|
| No known critical security defect | **Met after a late correction.** The High finding (open redirect) is fixed. The final scan found a **Critical**: the pinned Next.js 14.2.15 has published remote-code-execution and denial-of-service flaws; it is upgraded to 14.2.35 (finding 8). An earlier version of this table said none was known; that was wrong. Nobody outside the project has tested it. | `SECURITY-FINDINGS.md` |
| Tenant isolation passes | **Met.** Every company-owned table, probed as another company, as a signed-in stranger and as the public; by-identifier attacks on the main services; role escalation; documents and confidential letters. | `phase16a`, `tests/sql`; 305 integration tests passing |
| Important financial calculations independently checked | **Met for what exists.** Rent schedules, arrears, allocation, ledger (random run against a separate model), service-charge shares, commissions, valuations, rewards, platform books, import totals. **There is no tax computation in the product, so none was checked.** | `TEST-REPORT.md` |
| Core workflows pass end to end | **Met at service level and page level; not at browser level.** Acceptance tests walk each phase's journey through the services; the smoke test opens every signed-in page for two roles; no scripted browser journey exists. | `TEST-REPORT.md` |

## 2. Must be done before real customers or real money
1. **Make two-step sign-in mandatory for platform administrators**, and set `MFA_ENCRYPTION_KEY` to its own random value. Today both are optional.
2. **Connect an email provider.** Password reset, invitations, rent reminders and every notice are queued but not delivered without one.
3. **Connect Paystack** (keys, webhook address) and send a real small payment end to end. Everything about payments is tested with fakes.
4. **Set up the database and hosting** (Vercel, Neon): a plan with point-in-time restore, the connection settings in the runbook, and run the restore check on a copy of production.
5. **Set up an uptime monitor** on `/api/health` and decide who is called.
6. **Run a real company's file through the import preview** and read every Error and Duplicate line before confirming anything. The import has only been run on generated files.
7. **Test on real phones** on a Nigerian mobile network. Emulation does not show speed or touch quality.
8. **A load test** at the number of simultaneous visitors you expect in the first month.
9. **Dependency hygiene.** Commit a lockfile, run `npm audit`, and check for newer 14.2.x patches. Repeat monthly.
9b. **An outside security review** (a penetration test) before onboarding anyone whose records are sensitive.
10. **Legal text.** Privacy notice, terms, and what you do about data protection duties in Nigeria, written with a lawyer. This project has not produced them.

## 3. Conditions for a closed pilot
- A handful of known companies, onboarded by you, with their agreement that this is a pilot.
- Payments recorded by hand (bank transfer, entered by the administrator) rather than online, until item 3 above is done.
- Email replaced by telling people directly (the invitation link is shown once to the administrator to share).
- The administrator reads the "Gave up" email count and payments waiting for review daily (see the runbook).
- Any company-visible error or doubt about its numbers is treated as a level 1 incident (see the runbook).

## 4. Known limitations (not blocking a pilot)
- Substring search will need a `pg_trgm` index at several hundred thousand rows per company.
- Documents and photographs are stored in the database; fine for a pilot, plan an object store as volume grows.
- The Content-Security-Policy allows inline scripts.
- No breached-password check.
- The company ledger consistency check has no screen; it runs in tests.
- The AI assistant works on built-in rules unless `ANTHROPIC_API_KEY` is set; the connection to the AI service is tested only with a simulated service.
- Ads are not connected to an ad network and Paystack is not connected to real accounts; both are tested with fakes.

## 5. Defects
Open Critical: **0 known** (one found and fixed in the final scan). Open High: **0 known**. Open Medium: the items in `SECURITY-FINDINGS.md` under "Open" numbered 1 and 2. "Known" means found by the tests and reading in this phase; it is not a promise that none exist.
