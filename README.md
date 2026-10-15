# Housy — real estate marketplace and asset management CRM

This repository is the **first end-to-end vertical slice** from the master prompt (Section 51). It proves the core architecture before the wider platform is built:

- A company registers and gets an isolated workspace.
- It invites staff and assigns roles.
- It registers properties and other assets, attaches documents, and records owners, managers and custodians separately.
- It creates leases with generated rent schedules, records payments with evidence, and assigns inspections and maintenance.
- Every change lands in an append-only history.
- In parallel, a listing goes through platform review, appears on the public marketplace, receives enquiries, and shows the property verification recommendation (master prompt Section 9).

A user from one company cannot reach another company's records. This is enforced twice: in the application, and by PostgreSQL row-level security.

## Stack

| Layer | Choice |
|---|---|
| Web | Next.js 14 (App Router, server actions), React 18, TypeScript |
| Data | PostgreSQL 16, Prisma 5 |
| Isolation | Application scoping plus PostgreSQL row-level security (`prisma/migrations/*_rls`) |
| Auth | Email and password (bcrypt), database sessions in an httpOnly cookie |
| Tests | Node test runner via `tsx`, SQL tests for row-level security, GitHub Actions |

Money is stored as integer kobo. Dates are stored in UTC and shown in West Africa Time.

## Deploy on Vercel

You need a GitHub account with this repository and a Vercel account. Signing up to Vercel with GitHub is easiest.

1. **Import the project.** On vercel.com choose **Add New → Project**, pick **BOCALTD/Housy** and click **Import**. Do not deploy yet if Vercel offers to. If it deploys anyway, the first build fails until steps 2 and 3 are done. That is expected.
2. **Add a database.** In the project, open **Storage → Create Database → Neon (Postgres)**, choose a region close to Nigeria (for example Frankfurt, `eu-central-1`) and connect it to the project for all environments. This adds `DATABASE_URL` and `DATABASE_URL_UNPOOLED` automatically.
3. **Add three environment variables** under **Settings → Environment Variables**:

   | Name | Value |
   |---|---|
   | `APP_DB_PASSWORD` | A random string of 32+ letters and numbers. |
   | `SETUP_TOKEN` | Another random string of 32+ letters and numbers. Keep it private. |
   | `NEXT_PUBLIC_PLATFORM_NAME` | `Housy` |

   To make a random value, you can use a password manager's generator. Avoid quotes and backslashes.
4. **Deploy.** Open **Deployments**, then on the latest deployment choose **Redeploy**. Each build creates the restricted database role, applies migrations and grants access before building the app.
5. **Create your administrator.** Open `https://<your-project>.vercel.app/setup`, enter the `SETUP_TOKEN`, your name, email and a password. Tick the demo box if you want labelled sample companies and listings to look around. The page locks itself once the administrator exists.

After that, every push to `main` deploys automatically.

Uploads are capped at 4 MB per file, which is Vercel's request size limit.

## Set up locally

Requirements: Node 20+, PostgreSQL 16.

1. Create an owner role and a database. The owner needs `CREATEROLE` so setup can create the restricted runtime role `estate_app`.

   ```sql
   CREATE ROLE estate_owner LOGIN PASSWORD 'choose-a-password' CREATEDB CREATEROLE;
   CREATE DATABASE estate OWNER estate_owner;
   ```

2. Copy `.env.example` to `.env` and fill in the values.
3. Install, set up the database and start:

   ```bash
   npm install
   npm run db:setup            # creates estate_app, applies migrations, grants access
   npm run db:seed             # creates the first Platform Super Super Admin
   npm run dev
   ```

   Set `SEED_DEMO_DATA=true` before seeding to add labelled demonstration data. You can also use the `/setup` page instead of the seed script.

4. Open http://localhost:3000.

## Tests

```bash
npm run test:unit          # money, dates, rent schedules, permissions
npm run test:rls           # row-level security, run as estate_app
npm run test:integration   # the full vertical slice against a real database
npm run db:check-drift     # migrations match prisma/schema.prisma
```

GitHub Actions (`.github/workflows/ci.yml`) runs all of these, plus the type check, the production build, and a smoke test of the running app with demo data.

## Where things live

| Path | What it does |
|---|---|
| `prisma/schema.prisma` | Data model |
| `prisma/migrations/` | SQL migrations, including row-level security policies |
| `src/lib/db.ts` | Tenant-scoped transactions that set the security context |
| `src/lib/services/` | Business rules: companies, assets, leases, tasks, listings, verification |
| `src/lib/permissions.ts` | Role permission matrix |
| `src/app/app/` | Company workspace |
| `src/app/admin/` | Platform administration: listing review, verification providers and metrics |
| `src/app/properties/[ref]/VerifyModal.tsx` | Property verification recommendation modal |

## Verification providers

Setup creates **Bona Okorie Consulting & Advisory Ltd (BOCA)** as a pending provider with no profile text. To show it to buyers, a platform admin opens **Platform admin → Verification providers**. There they enter the approved profile, set the placement label and approve it.

Use **Affiliated** if BOCA shares owners or directors with the platform operator. Use **Sponsored** if it pays for the placement. Use **Editorial** only when neither applies.

## Built, deferred and not yet verified

**Built in this slice:**
- Registration, sign-in, sessions, company switching.
- Invitations and roles.
- Asset register with lifecycle status and history, ownership and responsibility records, and versioned documents with authorized downloads.
- Leases with rent schedules, evidence-based payments and arrears.
- Tasks, inspections and maintenance with assignment and outcomes.
- Dashboard.
- Listing drafts, platform review and publication, public search, enquiries.
- Verification modal with consent, provider leads, a private status page, withdrawal, and admin metrics that keep preselected defaults separate from confirmed interest.

**Built in Phase 4 (correspondence, files and document control):**
- Departments and a company reference prefix. Correspondence references follow PREFIX/DEPARTMENT/YEAR/NUMBER and never collide.
- Incoming and outgoing correspondence register with assignment, review, response drafting, approval by someone other than the drafter, dispatch, awaiting reply and closure with evidence.
- Response deadlines with overdue alerts, confidential records limited to managers and the people involved, attachments, notes and an append-only history.
- Physical file register with issue and return, overdue returns and movement history.
- Documents expiring within 60 days, and dashboard alerts for all of the above.
- Rate limits shared through the database, so they hold across serverless instances.

**Built in Phase 5 (leases, rent, service charges and obligations):**
- *Rent ledger:* leases per property or unit with grace periods, notice periods and custom payment intervals; rent schedules from the contract terms; receipts with unique numbers; payments applied oldest-charge-first, part payments, and each payment reference accepted once; reversal; reconciliation to a bank statement by someone other than the person who recorded it; late fees, waivers, credit notes and corrections that take effect only when a different person approves them; security deposit ledger with settlement after the tenancy ends; a ledger check that compares charges, payments and receipts.
- *Lease lifecycle:* renewal proposals approved by a different person (which creates the next lease), notices with short-notice flags, append-only move-in and move-out handover records, and closure that removes untouched future rent while keeping arrears and payments.
- *Service charges:* budgets per property and period, shared equally, by floor area or by fixed amounts using exact largest-remainder arithmetic; tenant collections with part payments and reversal; expenses approved by a different person and limited to what the fund holds; the fund balance is worked out from records and kept apart from rent.
- *Obligations and reminders:* company-entered levies, taxes, permits and insurance with authority, jurisdiction, evidence, recurrence and an optional professional-review gate; configurable "due soon" and escalation windows; a compliance calendar that also shows lease ends, notice dates and unpaid service charges; dashboard alerts.
- *Reports:* rent report by property and portfolio (billed, collected, arrears), arrears ageing, lease expiries and a CSV download.
- Financial records are append-only at the database level for the runtime role, and money checks (no overpayment, no negative balances) are enforced by database constraints as well as by the application.

**Built in Phase 6 (inspections, maintenance and inventory):**
- *Inspections:* checklist templates for each asset class (starter set included), scheduling and assignment, a checklist copied into each inspection so later template edits cannot change it, findings with severity, safety flag, estimated cost and photographs, submission, approval by someone other than the inspector and submitter, optional repeat scheduling, and a condition history on each asset.
- *Maintenance:* requests and work orders (reported, triaged, approved, assigned, in progress, awaiting parts, inspection required, completed, closed), priorities, risk and safety flags, contractor records with spend, estimated, approved and actual costs, materials, before and after photographs side by side, downtime, and an append-only event history. The cost approver cannot be the person who reported the work; the verifier cannot be the person who did it; completion needs notes plus an after photograph or a job card reference; closure is blocked if the actual cost is above the approved cost. A finding becomes one work order and the two stay linked. Recurring jobs create work orders ahead of each due date, once per due date, even when two people press the button together.
- *Emergencies:* emergency work can be assigned and started before approval, but cannot be closed until its cost has been approved by someone else. Urgent work nobody has taken up within 24 hours shows on the compliance calendar.
- *Inventory:* a register of contents, equipment and stock (fixed asset, movable or consumable) with item numbers, label codes, serial numbers, custodian, location, condition, reorder level and last-verified date. Balances change only through append-only movements (receipt, issue, transfer, return, consumption) that record who did them. Losses, damage, disposal and corrections need approval by a different person. Physical counts produce a variance report and need an approver who did not count; approval writes the differences as adjustments. Consumable stock can be issued to a work order, which adds it to that work order's materials.
- *Handover inventories:* room-by-room schedules per lease for move-in and move-out, with quantities, conditions and photographs. After the occupant's acknowledgement is recorded the schedule is frozen by the database, and a move-in versus move-out comparison lists what is missing, fewer, worse or new. The comparison is a record for people to review; it does not decide any deposit deduction.
- *Dashboards and alerts:* maintenance and inventory figures on the maintenance page; open work with a target date, urgent unattended work and due inspections on the compliance calendar and home dashboard.

**Rules to know about:**
- Several approvals need two different people (reconciliation, adjustments, renewals, service charge expenses). A company with one user cannot complete those steps until it adds a second member.
- Reminders are in-app only. Nothing is emailed or messaged.
- No tax rate or legal rule is built in. Obligations, amounts and jurisdictions are entered by the company, and items marked for professional review cannot be completed until a review is recorded.
- Service charges are not pro-rated for part-period tenancies. A recurring obligation that falls on the 29th to 31st can drift earlier after a short month.
- Floor areas are whole square metres.
- Phase 6: photographs must be JPG, PNG or WEBP and up to 4 MB. There is no QR or barcode image generation or camera scanning; each item shows its label code to print, and a hardware scanner can type a code into the lookup box.
- Phase 6: a physical count does not freeze stock. Differences are measured against the balance at the moment of approval, and the count line keeps what the books said when the count started.
- Phase 6: handover inventory lines are not linked to register items, and there is no valuation of lost or damaged contents.
- Phase 6: the "urgent and unattended" window is fixed at 24 hours.

**Deferred to later phases:**
- **Email and notifications:** no email sending yet. Invitation links are shown once to the administrator to share.
- **Provider portal:** providers can't sign in to see their leads yet. Platform admins handle leads for now.
- **Media and maps:** photo and video galleries, maps.
- **Email capture:** linking emails to correspondence needs an email provider, which is not configured yet.
- **Later modules:** valuation, construction, collaboration, messaging, reels, awards, referrals, vacancy reports, advertising, subscriptions, payments and AI.
- **Document storage:** document contents are stored in PostgreSQL (`stored_files`, protected by row-level security), capped at 4 MB per file. Move to an object store behind `src/lib/storage.ts` as volumes grow.

**Not yet verified:**
- The code was written in an environment that could not download packages. Row-level security tests and unit tests were run there. The type check, build, integration tests and smoke test run in GitHub Actions on first push, so check the Actions tab before relying on the build.
