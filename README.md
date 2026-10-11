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

Limits on Vercel's free plan to know about: uploads are capped at 4 MB per file, and the sign-in rate limit is per server instance.

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

**Deferred to later phases:**
- **Email and notifications:** no email sending yet. Invitation links are shown once to the administrator to share.
- **Provider portal:** providers can't sign in to see their leads yet. Platform admins handle leads for now.
- **Media and maps:** photo and video galleries, maps.
- **Later modules:** correspondence, service charges, valuation, construction, inventory, collaboration, messaging, reels, awards, referrals, vacancy reports, advertising, subscriptions, payments and AI.
- **Rate limiting:** it is in memory, so it applies per server instance. Move it to a shared store before running several instances.
- **Document storage:** document contents are stored in PostgreSQL (`stored_files`, protected by row-level security), capped at 4 MB per file. Move to an object store behind `src/lib/storage.ts` as volumes grow.

**Not yet verified:**
- The code was written in an environment that could not download packages. Row-level security tests and unit tests were run there. The type check, build, integration tests and smoke test run in GitHub Actions on first push, so check the Actions tab before relying on the build.
