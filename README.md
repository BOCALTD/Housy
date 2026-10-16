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

GitHub Actions (`.github/workflows/ci.yml`) runs all of these, plus the type check, the production build, a smoke test of the running app with demo data, and a device check of every signed-in page on desktop, iPhone, Android and tablet profiles (`scripts/device-check.ts`). The device check is strict by default; set the repository variable `DEVICE_STRICT` to `false` to make it report without failing.

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

**Built in Phase 7 (valuation, construction and renovation):**
- *Valuation instructions:* an instruction records the asset, purpose, basis of value, instruction, inspection and valuation dates, due date, and the professional assigned. Cancelled instructions stay on record.
- *Worksheets and evidence:* configurable sales-comparison, income-capitalisation and cost-approach worksheets with exact integer arithmetic (money in kobo, rates in basis points, areas in hundredths of a square metre). Comparable evidence is verified by someone other than the person who added it, and a verified comparable is locked. Assumptions, special assumptions, limitations, the going-concern or gone-concern premise, and supporting documents are kept with the instruction.
- *Reports:* a draft is saved and revised by the preparer. Submitting freezes a snapshot of the worksheets and evidence. A different person with approval rights approves or rejects it, and a database trigger refuses any change to an approved report. A revision is a new version. A report prepared with AI assistance cannot be approved until the approver confirms they reviewed it. AI never approves, signs or issues a valuation.
- *Projects:* construction, renovation, fit-out and repair projects on an asset, with work packages, schedules, milestones, responsible people, progress and a late/behind flag. A project cannot start until a second person approves the budget.
- *Cost control:* commitments (contracts and purchase orders), invoices, variations (against a contract or the budget, with time impact) and forecasts. Each is decided by someone other than the person who raised it, and the checks run again under a database lock at the moment of approval, so two approvals at once cannot overspend the budget or a contract. Cost reports show budget, committed, invoiced, paid and forecast.
- *Delivery:* contractors and consultants appointed to a project, procurement requirements through ordered and delivered (a delivery can be booked straight into consumable stock), stock issued to a project, a risk register scored likelihood by impact (a high risk needs an owner and a plan), dated site inspections with photographs, progress reports, and quality checks. A work package cannot be marked done while a quality check is waiting or failed, and the person responsible for the work cannot pass or waive their own check.
- *Completion and handover:* completion is requested, then approved by a different person after the checks run again. Defects can be raised during the works and through the defects liability period (0 to 60 months). A fix is verified by someone other than the fixer, a critical defect blocks completion, and a defect can be turned into one maintenance work order. Warranties and documents are kept with the project and linked to the asset. A handover checklist is created at completion, and the handover is recorded only when every item is ticked, no high or critical defect is open, and a recipient is named.
- *Links:* the asset page shows its projects, warranties in force and latest approved valuation. A work order shows when a warranty is in force on its asset. Completion and handover are written to the asset's history.
- *Alerts:* the compliance calendar includes warranty ends, defects-period ends, defect due dates, materials needed on site, risk reviews, milestones and valuation due dates. The dashboard has a folded Projects and valuations panel.
- *Device testing:* every page in the signed-in smoke test is opened on seven emulated profiles (iPhone SE, iPhone 14 Pro Max, Pixel 7, Galaxy S9+, iPad, desktop Chrome and desktop Safari) and checked for sideways scrolling, small text, small touch targets, unlabelled fields, missing alt text and script errors. This runs in CI and fails the build. It uses emulation, not physical phones.
- *Layout:* long lists and busy panels fold behind "show more" and expandable sections instead of stretching the page.

**Built in Phase 8 (CRM, clients and the transaction pipeline):**
- *Clients and leads:* client records with duplicate detection and merging, lead sources, assignment, qualification, follow-ups, and property requirements matched to published listings.
- *Deals:* a deal runs from enquiry to completion with viewings, offers, counteroffers and negotiation history. Accepting an offer and completing a deal each need a second person. Deals can be held, disputed (including after completion), reassigned or cancelled with a reason, and every change is kept in an append-only history.
- *Deal file:* documents, payments, linked correspondence, tasks and client conversations tied to the deal, following the deal's access rules. Confidential clients' deals are visible only to the owner and managers.
- *Commission:* company-set rules (percentage or fixed), splits that total 100% and divide to the exact kobo, approval by someone with no stake in the deal, payment per person, and withholding while a deal is disputed.
- *Dashboards and reports:* agent, team and branch dashboards, and a company report on conversion, pipeline, completed deals, cancellations and commission, with CSV export, for managers only.
- *Verification providers:* the buyer-journey recommendation, consent capture and lead tracking from the first slice are covered by the Phase 8 acceptance test. No personal data is stored before explicit consent, and a preselected default is recorded apart from confirmed interest.

**Built in Phase 9 (collaboration, subscriptions and secure messaging):**
- *Seekers and following:* anyone can create an account with no company (`/join`). Agents, companies and developers choose to be listed in the directory; anyone signed in can follow a listed profile, for free. Following gives no access and no paid feature.
- *Plans and entitlements:* the platform administrator creates plans and decides which features each switches on (seeker-to-agent collaboration, company collaboration, contact details, bulk messaging) and any limit. Starting plans are seeded **with no price**: set them yourself. A subscription runs active, then grace (full use, with a warning), then read-only, then suspended, on the plan's own day counts. A plan switches a feature on; it never widens what anyone can see.
- *Collaboration:* a seeker invites a listed agent, or one company invites another. The other side accepts or declines; invitations expire; either side can cancel, finish, or suspend. The platform can suspend one that breaks the rules, and only the platform resumes it. A seeker's workspace follows the seeker's plan; a company pair follows the weaker of the two plans.
- *The workspace:* shared properties, deal summaries, notes and documents, tasks and milestones, comments, and a permanent history. **What is shared is a copy of the fields the sharer ticked**, never a live link, and the other side never receives the client, the other deal terms, an internal identifier or a storage key. The sharer can update the copy or take it back; taking it back wipes the text and the file (enforced by the database). Each company chooses who on its side takes part, with per-person permissions and an optional end date, and removing someone takes effect on their next request.
- *Boundaries:* a company that collaborates sees nothing else of its partner's CRM, by the services or the database. A colleague who is not in the workspace is told it does not exist. Company supervisors see the roster, the history and the company report, but not the workspace content unless they are participants.
- *Messaging:* private conversations between two people. Only agents who chose to take messages can be messaged first, nobody can cold-message a seeker, and people in a live collaboration can always message each other (that conversation ends with their access). Property cards copy only a published listing's public details. Inspection requests are answered once. Read receipts, search, block and report are included.
- *Contact details and anti-spam:* phone numbers and email addresses are hidden from messages unless the sender's plan includes contact details; the platform can instead refuse such messages outright. The administrator sets messages per minute, new conversations per day, and how many different people must report someone before they are flagged. The administrator reads a message only after it is reported, and can pause a person's messaging.
- *Notifications and audit:* in-app only. Companies have a collaboration report (counts, what they shared and took back, recent activity).

**Rules to know about:**
- Several approvals need two different people (reconciliation, adjustments, renewals, service charge expenses). A company with one user cannot complete those steps until it adds a second member.
- Reminders and notifications are in-app only. Nothing is emailed, texted or pushed.
- Subscriptions are recorded by the platform administrator by hand until payments are built (Phase 13). Nothing is charged.
- A company invited to collaborate gets no personal notice (the platform cannot read another company's staff list); its managers and administrators see a count in the navigation and a list.
- Not built: typing indicators, voice notes, location sharing, message reactions, file attachments in direct messages (documents go in a collaboration workspace), and any behaviour for the bulk-messaging feature switch.
- No tax rate or legal rule is built in. Obligations, amounts and jurisdictions are entered by the company, and items marked for professional review cannot be completed until a review is recorded.
- Service charges are not pro-rated for part-period tenancies. A recurring obligation that falls on the 29th to 31st can drift earlier after a short month.
- Floor areas are whole square metres.
- Phase 6: photographs must be JPG, PNG or WEBP and up to 4 MB. There is no QR or barcode image generation or camera scanning; each item shows its label code to print, and a hardware scanner can type a code into the lookup box.
- Phase 6: a physical count does not freeze stock. Differences are measured against the balance at the moment of approval, and the count line keeps what the books said when the count started.
- Phase 6: handover inventory lines are not linked to register items, and there is no valuation of lost or damaged contents.
- Phase 6: the "urgent and unattended" window is fixed at 24 hours.
- Phase 7: valuation and project approvals need a second person. A company with one user can prepare but not approve.
- Phase 7: the worksheets are calculation aids for a professional. The platform applies no valuation standard, rate or legal rule, and a valuation is not an opinion of value until a professional has approved it.
- Phase 7: stock issued to a project is shown for information and is not added to the project's cost figures. Only approved commitments and invoices count as cost.
- Phase 7: invoice payment is a record that someone marked an invoice paid. No payment is made by the platform.
- Phase 8: deal tasks and linked correspondence are plain references checked by the application inside row-level security, not database foreign keys. Notifications and reminders are in-app only. The person a follow-up or task is assigned to must be able to see that client or deal. Approvals (accepting an offer, completing a deal, approving and paying commission) need people other than the owner, proposer and beneficiaries, so a small company needs at least three people.
- Layout: long lists and tables show the first few rows and fold the rest behind "Show more". Forms that span folded rows still submit every row.
- Saving documents: every document and the rent CSV has "Save or share". Download always works. On phones and tablets "Send to another app" opens the system share sheet (Files, iCloud Drive, Google Drive, Dropbox, OneDrive and others). "Save to Google Drive" appears when `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is set to a Google OAuth web client ID (Google Cloud Console, APIs and services, enable the Drive API, create an OAuth client for a web application, and add your site as an authorised JavaScript origin). It asks only for the `drive.file` scope, so it can touch only files it creates. Dropbox and OneDrive direct buttons are not built; use "Send to another app" on a phone or Download on a computer.

**Deferred to later phases:**
- **Email and notifications:** no email sending yet. Invitation links are shown once to the administrator to share.
- **Provider portal:** providers can't sign in to see their leads yet. Platform admins handle leads for now.
- **Media and maps:** photo and video galleries, maps.
- **Email capture:** linking emails to correspondence needs an email provider, which is not configured yet.
- **Later modules:** collaboration, messaging, reels, awards, referrals, vacancy reports, advertising, subscriptions, payments and AI.
- **Document storage:** document contents are stored in PostgreSQL (`stored_files`, protected by row-level security), capped at 4 MB per file. Move to an object store behind `src/lib/storage.ts` as volumes grow.

**Not yet verified:**
- The code was written in an environment that could not download packages. Row-level security tests and unit tests were run there. The type check, build, integration tests and smoke test run in GitHub Actions on first push, so check the Actions tab before relying on the build.


## Built in Phase 10: referrals, vacancy reports and rewards

- **One reward engine** for both programmes. A reward has one source, the policy version it was earned under, a status
  (not eligible, under review, eligible, approved, payable, paid, rejected, cancelled, disputed) and an append-only ledger.
  A source earns each event once. Policies are never edited: a change retires the old version and starts a new one.
- **Money rules.** Approval needs a budget for the month and stays inside it. After approval a safety period passes and the source
  (listing still published, subscription not cancelled, owner permission still in place) is checked again before the reward is payable.
  A payout is created by one administrator and verified, with the bank reference, by a different one. A failed payment returns the
  rewards to payable. A reward already paid whose source is later reversed is flagged for a person, not clawed back.
- **Referrals.** `/r/CODE` counts a visit and sets one first-party cookie. Sign-up captures the attribution inside the campaign window.
  Same mailbox, same name, bursts and brand-new referrers hold the reward for a person; nothing is decided automatically.
- **Vacancy reports.** A report is a sighting and never publishes anything. Seven review stages, forward only. Duplicates are linked by
  address or by position and kind; the earliest report owns the reward unless an administrator overrides with a reason. Owner permission
  lives on a separate lead. Reporters control outside contact and whether the owner is told their name; the public never is.
- **Fraud signals** (copied photographs, repeated text, report bursts, repeat rejections, positions outside Nigeria) send a report to a person.
- **Appeals and disputes** once per decision, decided by an administrator. Rewards can be paused per person.
- **Figures for administrators** are area-level only; areas with fewer than three reports are not broken out.
- Pages: `/referrals`, `/rewards`, `/vacancies`, `/admin/rewards`, `/admin/rewards/payouts`, `/admin/referrals`, `/admin/vacancies`.

## Built in Phase 11: plan levels, promotions and the platform rating

- **Levels.** Each plan carries a level: Basic (free), Silver or Gold. A company's level follows its subscription and falls back to Basic
  when the plan ends. Silver joins promotions free. Gold also gets the Golden badge, a "Premium listing" tag on its properties and a boost.
- **Boost, kept honest.** Gold listings take one of every three places in search, taking turns day by day, and carry the visible Premium tag.
  Nothing else about the order changes.
- **Promotions.** The platform creates campaigns (name, look, dates, fee, biggest discount). A company picks published properties and a
  reviewed price; the platform approves each one. Basic pays a fee per property, confirmed by hand with a reference before approval
  (a company that upgrades after asking is not charged). Companies cannot approve their own requests (database policy).
- **Price display.** The listed price is struck through in red and the reviewed price shown in green with the saving; words ("Was", "now") carry
  the meaning, not colour alone. A promotion shows only while approved, in its dates, the property published and the listed price unchanged.
- **Rating prompt.** Members are asked once per interval (administrator sets it, default 30 days), can choose "remind me later" (7 days), and
  may answer without their name shown. Administrators see averages, spread, monthly trend, paged suggestions, a status and note, and a CSV.
- Pages: `/app/promotions`, `/admin/promotions`, `/feedback`, `/admin/feedback`.
- **Not built:** online payment of promotion fees (recorded by hand), email or SMS reminders (the prompt is in-app), per-property boost purchase.

## Built in Phase 12: reviews, awards, completed deals, and reels

**Verified reviews and reputation.** A review is tied to a real interaction: a two-sided conversation that is a day old, or a single-use link the company issues after a completed deal or viewing. Suspicious patterns (a brand-new account, a burst of reviews, copied wording, a referral from the target) hold a review for a person to check. Agents can reply, dispute or report; the platform moderates. Reputation scores store their inputs and a hash, so they can be recomputed. Plans, Gold status and promotions are not inputs (tested).

**Top Agent of the Month.** An administrator computes a finished month from verified completed sales, listings the platform approved that month, published reels (up to a cap of 8) and published verified reviews (one per reviewer). Each run stores its facts and settings so `verifyRun` can recompute it. Runs are DRAFT, PUBLISHED, then FROZEN after a 7-day correction period with no open disputes. The top three get Gold, Diamond and Silver plaques; the leaderboard and archive are public. Weights and thresholds are set in `/admin/awards`.

**Recently sold, rented and leased.** A manager authorises showing a completed deal and the platform approves it. Only the category, bedrooms, area and completion date are shown, never price, names or documents. Entries age off after 90 days or as soon as the deal stops being completed.

**Reels and social.** Listed agents post short MP4/WebM clips (4 MB limit, see below). The platform checks every reel before it is public. People can like, save (private), share (once per person), comment (no links) and report. Three different reporters hide a reel and two hide a comment until the platform decides. Discovery ("For you", "Following", "Popular") ranks by engagement from other people on accounts at least a day old, decayed over time, plus the people you follow and areas you have engaged with. Paid plans and promotions are not inputs and self-engagement and brand-new accounts count for nothing (tested). Activity notices (new reel from someone you follow, comments, like milestones, moderation outcomes) are in-app only.

**Limits to know about.** Clips are stored in PostgreSQL and the request limit is 4.5 MB, so reels are capped at 4 MB (about 10 to 20 seconds). Real hosting (object storage with transcoding and thumbnails) belongs with the production setup. There is no automated content analysis: moderation is by a person plus reports.

## Built in Phase 13: notifications and email

**One entry point.** Everything that tells a person something goes through `notify()`. It always leaves the in-app notice, and also queues an email. Whether that email is really sent is decided later, when the queue is processed (`processOutbox`), so a person's settings can never be bypassed by a caller.

**Optional and essential mail are separate.** Security, billing, account-standing and platform-conduct messages are *essential*: always sent, ignore quiet hours and limits, and carry no unsubscribe link. Everything else is optional and follows the person's settings (`/me/notification-settings`): activity, property alerts and promotions can each be switched off; promotions are off until the person turns them on; quiet hours (Lagos time) hold optional mail until they end; a daily digest can batch it. Even for people who chose instant emails, after 5 optional emails in 24 hours the rest wait for one digest. The same event for the same person on the same day is one email. Unsubscribe links are signed and scoped, and also set the `List-Unsubscribe` headers.

**Delivery, retries and failures.** A failed send is retried after 1 minute, 5 minutes, 30 minutes, 2 hours and 12 hours, then marked as given up. A refusal that cannot be fixed by trying again (such as a bad address) is given up at once. `/admin/notifications` shows what was queued, sent, retried, given up, held, deferred, skipped and de-duplicated, lists failures with the provider's error, and retries them.

**Provider.** Email is sent with Resend when `RESEND_API_KEY` and `EMAIL_FROM` are set. Until then nothing is sent and nothing is marked as sent; the queue simply waits and the admin page says so. Run the queue on a schedule by calling `GET /api/cron/notifications` with the header `Authorization: Bearer $CRON_SECRET` (for example from a Vercel cron job, no more often than your plan allows). Set `UNSUBSCRIBE_SECRET`, `NEXT_PUBLIC_APP_URL` and `CRON_SECRET` in production. SMS, WhatsApp and push are not built: they wait for a provider and for people's permission.

**Property alerts without broadcasting.** When the platform first approves a property, only these people are told, each once and up to a cap (default 300; the property's own company is never included): people with a matching saved search, followers of the posting agent or company, and people who chose that area in their settings. The administrator chooses which of the three apply and the cap. People can watch a property to hear when it stops being available or returns. Enquiries reach the agent who posted the property and the managers. A newly listed agent or company is announced to the platform team.

**Templates.** Welcome, enquiry received, property alert, availability alert, new agent, rent reminder, inspection scheduled, review request, security notice, digest and a generic one for everything else. Values are escaped, subjects cannot contain line breaks and links must be web addresses or paths on this site. Welcome, enquiry, property and availability alerts, and the digest are connected to real events. Rent reminders, inspection notices and review-request emails have templates but are not yet triggered: they need a tenant, inspector or reviewer who has an account with an email address to send to.
