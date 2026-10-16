# Operations runbook

What to watch, what to do when something breaks, and how to get the data back. Written for the person on call. Nothing here needs special tools beyond the hosting dashboard, the database console and the admin pages of the product itself.

## 1. What to watch

| What | Where | Healthy | Act when |
|---|---|---|---|
| Is the app answering and can it reach the database | `GET /api/health` (public; says only up or down) | `200` with `"ok":true` | Anything else for 2 checks in a row (2 minutes) |
| Email backlog and stuck payments | `GET /api/health?detail=1` with the cron secret (`Authorization: Bearer ...`), or Admin → Notifications and email | No warnings; "Gave up" at 0 | A warning appears, or "Gave up" or "Will retry" keep rising for more than an hour |
| Payments that arrived but were not matched | Admin → Payments | Nothing waiting for review | Any item older than one working day |
| The platform books | Admin → Finance → "Run the check" | "Balanced" | Any difference at all. Stop changes to the money tables and start an incident |
| Assistant (AI) errors and cost | Admin → Assistant | Few failures | Failure rate above 20% for a day, or spend above the cap you set |
| Database size and connections | Neon dashboard | Under 70% of plan | Above 80%, or connection errors in the logs |
| Deploy status | Vercel dashboard | Last deploy green | Red deploy: the previous deploy is still serving; fix forward or promote the previous one |

Set an uptime monitor (any free one) on `/api/health` with a 60-second interval, alerting a phone. The health route returns `503` when the database cannot be reached, so the monitor catches a database outage as well as an app outage.

Nothing sends alerts by itself yet. The owner must connect an uptime monitor and decide who is paged. See "Not yet in place" in the release approval.

## 2. Incident response

Severity decides how fast you move.

| Level | Meaning | Examples | Start within |
|---|---|---|---|
| 1 | Data of one company can be seen by another, money is wrong, or a key leaked | Isolation failure, a ledger that does not balance, a leaked password or API key | Immediately |
| 2 | The product is down or a core workflow is broken for everyone | Health check failing, sign-in broken, payments not recorded | 30 minutes |
| 3 | A feature is broken or slow for some people | One report failing, email delayed | Next working day |

### First fifteen minutes, in order
1. **Write down the time and what was seen**, who reported it and how. Keep a running log in one place.
2. **Contain before you investigate.** For level 1: end the affected sessions (delete the person's rows from `sessions` in the database console, or reset their password, which signs out every device), suspend the company membership if one company is involved, and if the cause is unknown put the site in maintenance by promoting a static page in Vercel. For a leaked secret: rotate it first (see 2.2), then investigate.
3. **Check the basics:** `/api/health`, the last deploy, the Neon status page, the Paystack and email provider status pages.
4. **Decide the level** and tell the owner. Level 1 means the owner is told within the hour.

### 2.1 Where the evidence is
- **Who did what:** every change is in the activity log (`activity_log`, append-only, the app role cannot edit or delete it). Entries carry the person, the company, the record and the time.
- **Money:** receipts, payments, reversals and platform finance entries are append-only. A mistake is corrected by a new entry that names the person and the reason, never by editing.
- **Sign-ins:** the `sessions` table (hashes only) and the `rate_limits` counters.
- **Application errors:** Vercel → Logs. Server actions log the real error and show the person a plain message.

### 2.2 Rotating secrets
| Secret | Where it lives | How to rotate | What it breaks |
|---|---|---|---|
| Database app password (`APP_DB_PASSWORD`) | Vercel env | Change it in Neon and in Vercel, redeploy (the deploy step re-applies it) | Brief errors during the swap |
| `MFA_ENCRYPTION_KEY` | Vercel env | **Do not rotate casually.** Existing two-step secrets are sealed with it. Rotating without re-sealing disables two-step sign-in for everyone with it on. Plan it as a migration | All two-step users |
| Paystack secret and webhook secret | Vercel env and the Paystack dashboard | Create the new key, update Vercel, redeploy, then revoke the old one | Payments in flight fail and can be retried; the "ask Paystack" check settles any whose message was missed |
| AI provider key | Vercel env | Replace and redeploy | Assistant falls back to built-in rules |
| Cron secret | Vercel env | Replace in Vercel and in the cron configuration together | Scheduled jobs skip until both match |

### 2.3 After it is over
Write a short note within three working days: what happened, how it was noticed, how long it lasted, who was affected, what fixed it, what stops it happening again. If personal data of people in Nigeria was exposed, the owner decides with a lawyer whether the NDPC must be told (the Nigeria Data Protection Act expects notice within 72 hours of becoming aware of a breach likely to risk people's rights). This document does not make that decision.

## 3. Backups and recovery

### 3.1 What is backed up
- **The database** is the only store of business records. Neon keeps point-in-time history for the window of your plan (check the plan: the free tier window is short; choose a paid window that matches how much loss you can accept).
- **Uploaded documents and photographs** are stored inside the same PostgreSQL database (`stored_files`), in the same transaction as the record they belong to. One database backup therefore covers both. The cost is database size: watch it, and move to an object store with its own versioning when volume grows (the storage module is written to be swapped).
- **Code** is in the GitHub repository.

### 3.2 Targets (to be agreed by the owner)
| | Suggested | Why |
|---|---|---|
| Most data you can lose (RPO) | 15 minutes | Neon point-in-time restore with a paid history window |
| Longest outage (RTO) | 4 hours | Restore, re-point, verify |

These are suggestions. Nothing in the code enforces them; they come from the plan you buy.

### 3.3 A backup you have not restored is not a backup
CI runs `scripts/backup-restore-check.sh` on every push. It dumps the integration-test database (`pg_dump -Fc`), restores it into a fresh database, then compares every table's row count, the row-level-security settings on every table, the number of policies, constraints and indexes, and the money totals (receipts, payments, rent charged). It fails the build if anything differs, and prints how long the dump and the restore took. The numbers are in the CI summary under "Backup and restore". Run the same script against a copy of production once a month:

```
PGHOST=... PGUSER=... PGPASSWORD=... scripts/backup-restore-check.sh estate estate_restore_test
```

### 3.4 Restoring production
1. Decide the target time (just before the damage). Write it down.
2. In Neon, create a **branch from that time** (do not overwrite production). This is a full copy you can inspect.
3. Connect to the branch as the owner role and run the checks in 3.5.
4. If good: either promote the branch, or point `DATABASE_URL` and `MIGRATION_DATABASE_URL` at it in Vercel and redeploy. The deploy step re-creates the runtime role and privileges.
5. Tell people that work done after the target time must be re-entered. The activity log of the old database (still available on the original branch) lists exactly what that was.
6. Keep the old branch for 30 days before deleting it.

### 3.5 After any restore, check
- `/api/health` returns ok.
- Admin → Finance → "Run the check" says Balanced.
- The company ledger consistency check (`verifyLedger`, exercised by the integration tests) finds no problems for a sample company. It has no screen yet; run it from a script or add one.
- Sign in as a test user from two different companies and confirm each sees only its own records.
- Send one test email and open one uploaded document.

## 4. Routine
| When | Task |
|---|---|
| Daily | Glance at "Gave up" email, payments waiting for review, the health monitor |
| Weekly | Review failed assistant runs; review new platform admins and any role changes |
| Monthly | Run the restore check on a copy of production; check database size; review who has platform admin access |
| Quarterly | Rotate the cron secret; read the security headers report; review dependencies for known problems (`npm audit`) |
