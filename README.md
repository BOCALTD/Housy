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
| Web | Next.js 16 (App Router, server actions), React 19, TypeScript |
| Data | PostgreSQL 16, Prisma 5 |
| Isolation | Application scoping plus PostgreSQL row-level security (`prisma/migrations/*_rls`) |
| Auth | Email and password (bcrypt), database sessions in an httpOnly cookie |
| Tests | Node test runner via `tsx`, SQL tests for row-level security, GitHub Actions |

Money is stored as integer kobo. Dates are stored in UTC and shown in West Africa Time.

## Deploy on an Ubuntu server

Housy runs on one Ubuntu 22.04/24.04 server: nginx (TLS) in front, the app on the loopback, PostgreSQL 16 on the same machine, systemd timers for the email queue, billing and nightly backups. The scripts and the step-by-step guide, including what you take on by self-hosting, are in [docs/UBUNTU.md](docs/UBUNTU.md) and `deploy/ubuntu/`. They have not yet been run on a real server.

Uploads are capped at 4 MB per file.

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

   To see the platform full of sample content, run `npm run db:seed:demo` instead of `npm run db:seed` (or tick the demonstration box on the `/setup` page). It adds six sample companies and their agents, about 30 published properties in Lagos, Abuja, Port Harcourt, Ibadan and Enugu with several photographs each, ten property reels (short videos), promotions, completed sales, client reviews, flatmate profiles and a full company workspace. A dark strip at the top of every page says the data is a sample. Sign in as `demo.alpha@example.test`, `demo.lekki@example.test` (company), `demo.kemi.agent@example.test` (agent) or `demo.seeker@example.test` (person looking for property), password `demo-password-123`. Never load it on the live site.

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

**Provider.** Email is sent with Resend when `RESEND_API_KEY` and `EMAIL_FROM` are set. Until then nothing is sent and nothing is marked as sent; the queue simply waits and the admin page says so. Run the queue on a schedule by calling `GET /api/cron/notifications` with the header `Authorization: Bearer $CRON_SECRET` (for example from a Vercel cron job, no more often than your plan allows). Set `UNSUBSCRIBE_SECRET`, `NEXT_PUBLIC_APP_URL` and `CRON_SECRET` in production. SMS and WhatsApp are not built: they wait for a provider and for people's permission. Push notifications are built (see below).

**Property alerts without broadcasting.** When the platform first approves a property, only these people are told, each once and up to a cap (default 300; the property's own company is never included): people with a matching saved search, followers of the posting agent or company, and people who chose that area in their settings. The administrator chooses which of the three apply and the cap. People can watch a property to hear when it stops being available or returns. Enquiries reach the agent who posted the property and the managers. A newly listed agent or company is announced to the platform team.

**Templates.** Welcome, enquiry received, property alert, availability alert, new agent, rent reminder, inspection scheduled, review request, security notice, digest and a generic one for everything else. Values are escaped, subjects cannot contain line breaks and links must be web addresses or paths on this site. Welcome, enquiry, property and availability alerts, and the digest are connected to real events. Rent reminders, inspection notices and review-request emails have templates but are not yet triggered: they need a tenant, inspector or reviewer who has an account with an email address to send to.

## Built in Phase 14: advertising, payments and subscriptions

- **Payments.** A person or company buys a plan from `/me/billing` or `/app/billing`. An invoice is raised, and money counts only from a signed Paystack message, Paystack's own answer to a verify call, or a payment the platform administrator records for a bank transfer. Repeated or simultaneous messages are processed once. A wrong amount or currency, or a payment for a cancelled invoice, goes to review with the money in suspense and switches nothing on. Renewal invoices are raised from 7 days before the end, with reminders.
- **Advertising.** A plan feature (`ADVERTISING`, counted by concurrent campaigns). A campaign promotes one published property in the home page (3 slots) or at the top of search (2 slots), is reviewed by the administrator, is invoiced for its whole budget, and runs only when paid and inside its dates. It is pay-per-click: one charge per visitor per day, never for robots or the advertiser's own people, with an optional daily limit. The database refuses spending beyond funds. Adverts are marked "Sponsored". Results separate paid and organic visits and enquiries, and export as CSV.
- **Books.** `/admin/finance` shows the subscription and advertising ledgers (revenue, funds held, suspense), an append-only entry list with CSV, a reconciliation check across invoices, payments, refunds, campaigns and rewards, and corrections that need a named administrator and a reason. Refunds are reserved once under a lock, cannot exceed what was paid (adverts: what is unspent), and take back the time bought on a full refund.
- **To go live.** Set `PAYSTACK_SECRET_KEY`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET` and `UNSUBSCRIBE_SECRET`; register `/api/webhooks/paystack` with Paystack; schedule `/api/cron/billing`. Without a key nothing is pretended to be paid: bank transfer with an administrator-recorded payment is the path. Add the Advertising feature to the plans that should have it.

## Built in Phase 15: AI assistance, analytics and location

- **The assistant never decides anything and never needs to be on.** Every assisted feature has built-in rules that do the job when no AI service is connected, when a limit is reached, when the administrator switches it off, or when the service fails or answers badly. Pages say which one answered. To connect a service, set `ANTHROPIC_API_KEY` (and optionally `AI_MODEL`); only the text a person asks about is sent, and confidential letters are never sent.
- **What it does.** Property search from a sentence (`/find`) and ranked matches with reasons; sorting unfiled documents and summarising letters into suggestions that a manager must accept (legal and financial letters need a written note and a second person); questions about the portfolio, answered from a fixed list of reports (occupancy, arrears, leases ending, maintenance, values, projects, compliance), never a free-form query; missing-information checks on assets and valuations. It never writes valuation, legal or financial figures.
- **Control and audit.** Roles: `ai.use`, `ai.review`, `ai.audit`. Limits per person per day, per company per month and per public visitor per day are set in `/admin/ai`. Every use, refusal and fallback is recorded in an append-only table without the text itself; companies read their own record at `/app/assistant`.
- **Dashboards** (`/app/analytics`): occupancy, arrears ageing, maintenance, portfolio value (approved valuations only), project progress and compliance deadlines, counted from the company's records, each panel shown only to roles allowed to see it.
- **Maps.** A built-in map (no outside map service, nothing sent anywhere) with clusters, zoom, a place-and-distance filter and a "use my location" option that stays in the browser. Public listings appear at an area about 1 km wide; exact positions set on an asset stay inside the company. Vacancy sightings appear one by one only to the platform administrator; managers see counts for areas with at least 3 recent sightings. Properties without a position are placed at the centre of their city from a built-in list of Nigerian places, and are drawn paler.
- **Limits worth knowing.** The map is a simplified outline, not street tiles. The default model name is a guess you should set with `AI_MODEL`. The Anthropic connection is tested only with a simulated service.

## Built in Phase 16: testing, security and data migration

Reports are in `docs/`: [TEST-REPORT](docs/TEST-REPORT.md), [SECURITY-FINDINGS](docs/SECURITY-FINDINGS.md), [PERFORMANCE](docs/PERFORMANCE.md), [MIGRATION](docs/MIGRATION.md), [RUNBOOK](docs/RUNBOOK.md) and [RELEASE-APPROVAL](docs/RELEASE-APPROVAL.md).

- **Security.** Fixed an open redirect after sign-in, download-name header injection and a permission check that could throw on unknown input; added a Content-Security-Policy and HSTS. Added password reset by emailed one-time link, change-password with sign-out of other devices, and two-step sign-in (authenticator app, encrypted secret, each code usable once, ten recovery codes) at `/me/security`. Two-step sign-in is optional; the platform administrator page nags until it is on.
- **Tests that attack.** Cross-company, signed-in-stranger and public probes of every company-owned table, by-identifier attacks on the main services, role escalation, invitations, document and letter access, uploads, spreadsheet injection, SQL, cookies and headers.
- **Money checked a second way.** Rent schedules, arrears, payment allocation, service-charge shares, commissions, valuations and reward states are recomputed independently; a random run of payments, reversals and adjustments is applied to a real lease and a separate model and must agree to the kobo after every step; the platform books are checked after the whole suite.
- **Performance** at 12,000 assets, 12,000 listings, 2,500 leases and 30,000 charges: every measured page under a quarter of a second on the CI runner. Found and fixed an index the live app could not use, unbounded drop-downs and an unpaged report.
- **Accessibility.** Skip link, one main heading per page, names on controls, keyboard Tab order with visible focus, no keyboard trap, and animations that stop under reduced-motion, all checked on every page in the device check.
- **Recovery.** `scripts/backup-restore-check.sh` dumps and restores a database and compares every table, the security settings and the money totals; CI runs it on every push. `/api/health` serves uptime monitors.
- **Bringing in existing records** (`/app/import`, company administrator only): CSV templates for assets and leases, a preview that marks duplicates and mistakes, creation only on confirmation, opening balances for rent already paid, and a reconciliation of totals.
- **Limits worth knowing.** No outside penetration test, no load test with many simultaneous visitors, no scripted browser journeys through whole workflows, no real phones (emulated browsers only), no tax calculations exist to validate, and the import has never been run on a real company's data.

## Built in Phase 17 (master prompt Phase 16): production launch and operational readiness

What code and documents can do is done; the launch itself needs your accounts and people. Nothing has been deployed, no real email or payment has been sent, and no pilot has been run.

- **Launch readiness** (`/admin/launch`, platform administrators): lists which production settings exist and look sane (database, secrets, two-step key, HTTPS address, email, payments live or test, cron secret, demo data off, support contact), never their values, plus live email and payment backlogs and links to the books check. "Ready" means configured, not proven.
- **Two-step sign-in for platform administrators can now be required**: set `REQUIRE_ADMIN_MFA=true` and an administrator without it can reach only the page that turns it on (admin pages and admin downloads).
- **Help and support** (`/support`, linked from every page): contact details from `SUPPORT_EMAIL`, `SUPPORT_PHONE`, `SUPPORT_HOURS`, and steps for lost passwords, lost authenticators, suspected takeover, dead invitations and wrong-looking money.
- **Documents** in `docs/`: [LAUNCH-CHECKLIST](docs/LAUNCH-CHECKLIST.md) (all twelve launch items with owner and proof), [ONBOARDING](docs/ONBOARDING.md) with a 60-minute training agenda, [USER-GUIDE](docs/USER-GUIDE.md), [SUPPORT](docs/SUPPORT.md) (roles, levels, escalation, identity-before-access recovery), [ROLLBACK](docs/ROLLBACK.md), [PILOT](docs/PILOT.md) (who, rules, measures, feedback record). `vercel.cron.example.json` holds the job schedules.
- **Limits worth knowing.** Slow-query and server-error monitoring live in the hosting dashboards, not in the product. Removing a lost two-step secret is a manual database step (documented). Names and phone numbers in the support document are blank for you to fill.

## Built in Phase 17 (master prompt §49, §8 and §5): API, public pages, KYC and trust levels

- **Versioned read-only API** (`/api/v1`): `GET /api/v1/listings` and `/api/v1/listings/{ref}` (public, published only), `GET /api/v1/assets` (needs a key with `assets:read`), and `GET /api/v1/openapi` (OpenAPI 3 description). Paged envelopes (`data`, `meta`, `links`), one error shape, `X-API-Version`, rate limits per address and per key, money as whole kobo. Company administrators make keys at **Workspace → API keys**: shown once, stored as a SHA-256 fingerprint, scoped, expiring (up to a year), revocable, last use recorded.
- **Public pages**: amber-on-grey look (light grey page, white cards, amber accent, near-black text). Home has a photo hero with search, live counts (registered companies, listed agents, published properties, completed deals, cities), promotion flyers and offer cards, category tiles, featured properties, cities with listing counts for the visitor's country (from `cf-ipcountry`, `x-vercel-ip-country` or `X-Country-Code`; falls back to Nigeria), how it works, companies and agents with trust levels, reels, recently completed deals, reviews, partners and FAQ. New pages: `/faq`, `/how-it-works`, `/safety`, `/about`, `/reviews`; a full site footer.
- **Partners** are added only by platform administrators at `/admin/partners` after an agreement exists (name, kind, website, logo). With none, the home page invites partnerships instead of inventing logos.
- **KYC and trust levels.** Companies (`/app/verification`, top administrator only): CAC registration, director's government ID, office address, phone and email, TIN, professional membership. Agents (`/me/verification`): government ID, photo, phone, address, licence. Reviewers decide at `/admin/kyc` and must record what was checked (shown publicly), what they relied on and any limitations; checks expire (12–24 months). ID numbers are encrypted with `MFA_ENCRYPTION_KEY`, documents are never public, an agent's checks are hidden from their employer, every reviewer look at a document or full ID number is logged, and only a reviewer can mark a check Verified (enforced in the database). The trust level is computed from live checks: *Not verified*, *Basic checks*, *Verified* (core checks passed), *Highly trusted* (core + address + 80%). Badges show on company and agent pages, the directory, listing pages and the dashboard.
- **Photos.** The hero, tiles and demo listings use demonstration photographs from Unsplash (licence allows free use); see `public/stock/CREDITS.md`. Replace them with your own when you have them.
- **Not done.** No automated identity lookup (NIMC, CAC API, BVN) is connected: reviewers check by hand. No terms of use or privacy policy pages, because those are legal documents for you and your lawyer.

## Built in Phase 17, continued: listings, tools, safety, governance, portals and the installable app

- **Richer listings and browsing** (`/browse`, `/browse/<category>`): property type, price period, fees, sizes, furnishing, condition, construction stage, title document, amenities, floor plans and video; ten category pages with counts; filters with "More filters" folded away.
- **Compare and calculators** (`/compare`, `/calculators`): up to four properties side by side; affordability, move-in cost, purchase cost, rental yield, portfolio income, maintenance budget, loan payment, investment and development appraisal.
- **Inspections and safety** (`/me/inspections`, `/app/bookings`): booking requests, confirmed times with clash checks, reminders, a live safety session a trusted contact can watch while the page is open, and the Trust and Safety Centre (`/trust`, `/admin/cases`) for reports with deadlines by severity.
- **Platform governance and privacy**: suspending and restoring a company (`/admin/companies`), editable property types, amenities and title documents (`/admin/reference`), purpose-stated, time-limited admin access to company records (shown to the company), and personal data export and deletion (`/me/privacy`).
- **Owner portal** (`/portal/owner/…`): a company (**Workspace → Portals**, managers and the top administrator) invites a property owner by email and ticks the properties they may see. The owner sees listing status, visits and enquiry counts (never who enquired), inspection counts, tenancies with rent paid, outstanding and next due, maintenance jobs and costs, and approved valuation reports. Read-only.
- **Vendor portal** (`/portal/vendor/…`): an invitation tied to one of the company's contractors. The vendor sees only jobs assigned to that contractor from assignment onwards (no tenant contacts or internal notes), keeps a profile with service areas, qualifications, insurance and a compliance document, and sends quotations, invoices and completion reports with a file. The company accepts or returns each one on the work order; an accepted quotation sets the estimate and an accepted invoice the actual cost.
- **Provider portal** (`/portal/provider/…`): platform administrators add a verification or professional-services provider's staff by account email (on `/admin`, under each provider). Staff see only the requests people chose to send to that provider, only while it is approved, and move them forward with a note the person can read.
- **How portal access is enforced.** Invitation links work once, for 14 days, and are shown once. The database lets a person read only grants they hold and write submissions only on an active vendor grant; company records are then read for exactly the properties or contractor on the grant. Removing access closes the portal at once. A suspended company's portals close too.
- **Installable app (PWA).** A web app manifest with home-screen icons, an "Install the app" button in the footer when the browser offers it, and a service worker (`public/sw.js`, production builds only) that caches static files and anonymous copies of public pages (fetched without cookies, so no account details are ever stored), with an offline page. Signed-in areas, the API, documents and messages are never cached, and nothing is saved while offline.
- **Owner statements (PDF).** In the owner portal (and for the company, on **Workspace → Portals**), download a statement for last month, this year so far, or any dates up to a year: rent due and received (receipts not reversed), what is still outstanding, and maintenance completed with its cost, property by property, with a net figure before management fees. Made by a small built-in PDF writer, so there is no extra library to maintain.
- **Vendor payments.** On the work order, a manager records payment of an accepted invoice (date, amount, transfer reference; part payments allowed; a mistaken record can be cleared, and both are logged). The vendor is told, and the vendor portal shows what is accepted but unpaid and what has been paid. The database stops a vendor from changing or claiming a payment.
- **Inspections in your calendar.** A confirmed inspection has an "Add to calendar" button for the person who asked and for the company's staff (a standard .ics file for Google, Apple and Outlook, with a one-hour reminder). Each person can also turn on a private calendar link (on **My inspections** or **Bookings**) that calendar apps subscribe to: it lists inspections they asked for and ones they are meeting people at, updates when a time changes, marks cancellations, and can be replaced or turned off at any time. Visitors' phone numbers are never put in calendars.
- **Push notifications.** On **My account → Email settings** (Notification settings), a person turns on notifications for each phone or computer, sends a test, and sees or removes their devices. Every in-app notice (inspections, messages, portal decisions and payments, security) is also pushed within about a minute; offers and promotions never are. Messages are encrypted for each device (Web Push with VAPID, built on Node's own crypto, no extra library), the server only sends to the real push services (Google, Mozilla, Apple, Microsoft), dropped devices are forgotten, and failures are retried five times. On iPhone and iPad, notifications work once the app is on the home screen (iOS 16.4 or later). Setup: `install.sh` generates `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` (or run `npx tsx scripts/vapid-keys.ts`), and the `housy-push` timer runs the sender every minute. Keep the keys for good: changing them means everyone turns notifications on again.
- **Street map** (`/map`, the company's **Map**, and the admin vacancy map). A real street map (Leaflet with OpenStreetMap tiles by default; any tile provider through `NEXT_PUBLIC_MAP_TILES`). It opens on the visitor's own country (from the hosting proxy's country header, or the browser's language): Nigeria, Ghana, the United Kingdom, Canada and the other listed countries; elsewhere, the world. Properties load for the visible area as you move and zoom (grouped into numbered circles when there are many), with price pins, photo cards, a list of what is in view, filters (buy/rent/lease, type, price, bedrooms), a place search and "Near me". Public positions are blurred to about a kilometre; listings without a set position sit at the centre of their named area. Each property page shows its area on a small map. Companies set an asset's position by tapping the map (or typing coordinates); positions anywhere in the world are accepted. Google Maps itself is not used: it needs Google's own script, key and billing, and its terms do not allow its tiles in another map library.
- **Side menu.** The workspace, account, portals, messages and platform admin use a grouped, foldable side menu (a drawer on phones and tablets); the site header folds behind a Menu button on small screens.
- **Still not done.** No background sync (nothing is saved while offline). Portal invitations are links to copy, because email sending is not set up. Payments to vendors are recorded, not made: the platform does not move money.

## Flatmate matching and chat rooms

- People looking to share fill in a flatmate profile at `/flatmates/profile`: city and areas, budget, move-in date, age band, and twelve lifestyle questions (smoking and whether a smoking flatmate is all right, early riser or late nighter, introvert or extrovert, tidiness, guests, noise, drinking, pets, working from home, cooking, and whether they want an LGBTQ+ inclusive home). Up to three answers can be marked as must-match.
- Every pair gets a score from 0% to 100%, shown as a ring with a band: **Perfectly matched** (85%+), **Excellent match** (65%+), **Average match** (40%+) or **Poorly matched**. The score is a weighted comparison of answers, budget overlap, move-in dates and age; a clash on a must-match answer caps the score at 39%. Each match shows the main reasons it scored as it did.
- People are only shown to each other in the same city and country, when at most one of them has a room, and when both gender preferences allow it. Blocked and hidden people never appear.
- The LGBTQ+ answer is optional, has an "I'd rather not say" choice, is never shown to anyone or named in match reasons, and only affects the score. Gender is shown only if the person chooses to show it.
- Sending a request to a match is limited to 20 a day. When the other person accepts (or has already sent a request back), both are taken into a private flatmate chat room built on the existing messages, with blocking, reporting and contact masking. Either person can add another matched flatmate to the room (up to 6 people) or leave it; a room with fewer than two people closes.
- Profiles can be paused or deleted at any time, and the data is included in the privacy export and deletion.
- The demo data gives the demo seeker a flatmate profile, one accepted match with a chat room, and one request waiting.

## Sharing properties, reels, agents and companies

- Every property, reel, agent profile and company profile has a **Share** button. It opens a share sheet with:
  - on phones, the phone's own share screen with the photos (or the reel's video) attached as well as the words and link, which is how they reach Instagram, WhatsApp Status, Stories and any other app;
  - one-tap links for WhatsApp, Facebook, X, LinkedIn, Telegram, email and text message, with the words filled in;
  - copy link, copy the words and link together, and download the photos.
- The shared words carry the key facts (title, price, place, bedrooms, who listed it, or an agent's rating) and invite people to sign up free to see more.
- Link previews: each of these pages has its own preview picture (`opengraph-image`), with the property's first photo, price and place, or the agent's or company's name and rating, plus the platform name. WhatsApp, Facebook, X, LinkedIn and Telegram show it when the link is pasted.
- Back to the app: a signed-in person's link goes through `/r/CODE?to=/properties/…`, which remembers their invite code (so anyone who joins through it counts as their referral) and opens the page. Only property, reel, agent and company pages can be targets; anything else goes to sign-up.
- Visitors who are not signed in see the first 3 photos (the rest show as a blurred "+N more photos" slide), the newest 3 reviews on profiles, and an invitation to sign up free. Someone who opened a shared link is greeted with "Someone shared this with you". After signing up or in they return to the same page.

## Automatic identity checks, with people as the fallback

- When a company or agent sends an ID, CAC registration or TIN check, they can tick **"Check these details automatically against the official record"** (never ticked for them).
- With that agreement, the check is compared at once with the official record through a licensed provider:
  - **NIN** (NIMC), **voter's card** (INEC) and **driver's licence** (FRSC) for a director's or agent's ID: the surname and at least one other name must match the record, in any order, ignoring titles and one slip in a long name;
  - **CAC registration**: the registered name must match (ignoring "Limited", "Nig." and punctuation) and the company must be active;
  - **TIN**: looked up with the company's RC number and must match.
- A match is **verified straight away** (recorded as checked automatically, with the provider's reference; the reviewer shows as "system"). The person is told.
- Anything else goes to the **verification team** under Platform admin → Identity and business checks, with the reason: details did not match (the record's name is shown masked), no record found, the provider was unavailable, a passport (no provider checks passports), or no agreement. The team decides by hand as before, can try the automatic check again after an outage, and can revoke any automatic verification.
- Address, photo, phone and professional licence checks are always done by a person.
- Providers: **Dojah** (`DOJAH_APP_ID`, `DOJAH_SECRET_KEY`: NIN, CAC, TIN) and **Youverify** (`YOUVERIFY_TOKEN`: NIN, voter's card, driver's licence). Set either or both; `KYC_PROVIDERS` sets the order. If one is down, the next is tried, then a person. Only the names and company details needed for the comparison are read; photos, dates of birth and phone numbers in the provider's reply are not stored. The launch checklist shows whether automatic checks are on, and warns about sandbox keys.

## Sample photographs and videos

- `prisma/demo-media/photos`: about 90 photographs (exteriors, living rooms, bedrooms, kitchens, bathrooms, offices and warehouses) from Unsplash, under the Unsplash Licence; ids in `CREDITS.md`. They are stand-ins and do not show the sample properties.
- `prisma/demo-media/reels`: the property reels, vertical MP4 clips made from those photographs with slow zooms, cross-fades and the property's name, price and area. Rebuild them after changing the catalogue with `npx tsx scripts/make-demo-reels.ts` (needs ffmpeg).
- The catalogue itself (companies, agents, properties, reviews) is in `src/lib/demo-catalogue-data.ts`.

## Location intelligence

- **Satellite view.** Every map offers Streets and Satellite (with street and place names) when the provider allows it: with MapTiler in `NEXT_PUBLIC_MAP_TILES`, the same key gives satellite; or set `NEXT_PUBLIC_MAP_SATELLITE_TILES`. The choice is remembered on the device. Without either, only streets are shown: no free satellite source may be used for a live site without an account.
- **Search within a distance.** On the map: "Within 1, 2, 5, 10, 20 or 50 km" of where you are, a searched place, or the map centre. Results are listed nearest first with the distance, the circle is drawn, and the search is kept in the address so it can be shared (`/map?near=6.45,3.47&km=5`). Property pages link to "other properties within 2 km".
- **What is nearby.** Each property page lists schools, hospitals and clinics, pharmacies, supermarkets and markets, banks, filling stations, bus stops, places to eat, places of worship, parks and police stations within about 1.5 km, nearest first, and can show them on the map. The data is OpenStreetMap, fetched through an Overpass server (`OVERPASS_URL`, the public one by default) and kept for 30 days per square kilometre in `nearby_cache`, so a busy site makes few requests. Only the property's blurred public position is ever sent. `NEARBY_PLACES=off` switches it off.
- **How long to get there.** A visitor chooses a place (their work, a school, or where they are) and sees the time by car (a range from quiet roads to rush hour) and on foot, with buttons that open Google Maps, Apple Maps or Waze. With `ROUTING_URL` set to an OSRM-compatible server, real driving times are shown instead of estimates. The chosen place stays on the visitor's device.
- **Site outlines.** On an asset page, a company can draw the outline of an estate, development or plot (switch to Satellite to see the plots), with its area worked out. It appears on the public listing only when they tick "show this outline", because it shows the exact site; use it for estates and land, not occupied homes.
- **Inspection directions and the day's route.** When an inspection is confirmed, the visitor gets the exact spot on a map with directions buttons (it is never shown before). Agents and managers have "The day's route": a person's confirmed inspections in time order on the map, with distances between stops and the whole round in Google Maps.
- Not available: neighbourhood boundaries (there is no reliable open dataset for Nigerian neighbourhoods), live traffic.

## Industry templates (business set-up)

- **Business set-up** (`/app/setup`, company administrators) prepares the workspace for one of five kinds of business: a letting and property management agency, a sales and lettings brokerage, a property developer, a facility manager, or an institutional or government portfolio.
- Each suggests departments, inspection checklists made for that work (move-in and move-out, site progress and snagging, building services and fire safety, annual asset verification and boundary checks...), reminders for the levies, renewals and permits that kind of business usually has, commission rules, and reminder timings.
- Nothing is applied unseen. The administrator unticks what they do not want, enters when each reminder is next due and their own commission percentages (the usual market figure is shown only as a guide), and applies. No amount, rate or date is invented. Applying again adds only what is missing and never changes what exists.
- The dashboard invites a new company to choose a set-up, then shows the first steps for the one chosen.

## Market insights, benchmarks and rent forecast

- **Market prices** (`/market`, `/market/[city]`): asking prices and yearly rents for homes, by bedrooms, per square metre, gross yield and time on the market, worked out from published listings (and those taken off the market in the last year). A figure appears only when at least 5 listings from at least 2 companies sit behind it; shared rooms and nightly short lets are left out of home prices. Recalculated at most once an hour.
- **How you compare** (`/app/analytics`): each published home against the middle half of its city for the same bedrooms, and occupancy and rent collection against the middle company — shown only once at least 5 companies have enough records, never naming any of them.
- **Rent forecast** (`/app/analytics`): the next 12 months of rent due on active leases, the share likely to come in at the company's own collection rate (needs 6 past charges), arrears already owed, and a year's rent on leases ending without a renewal. Every figure comes from the company's own records.
- `listings.off_market_at` records when a listing was let, sold or withdrawn; time-on-market figures start from listings taken off after this release.

## Offline field work (field kit)

- **`/field`**: inspectors download the open inspections assigned to them (last 60 days and next 14, up to 25) while they have a connection, then record them on site without one: checklist answers, condition, summary, defects and photos (shrunk to 1600 px on the device). Everything is kept in IndexedDB in that browser, keyed by the user, until it reaches the office. "Remove from this device" clears it.
- **Sending** (`/api/field/sync`, `/api/field/photo`, `/api/field/submit`): each send carries the device's own id, so a retry after a dropped connection is applied once (`field_syncs`). The sign-in, role and assignment are checked when the work arrives, not when it was downloaded; same-origin requests only.
- **Conflicts**: the device sends the copy it downloaded with its own. Changes made only on the device apply, changes made only in the office stay, and where both changed the same answer differently the office's stays and the inspector chooses (`src/lib/field-merge.ts`). An inspection the office has closed is never changed.
- **Not offline**: payments, identity checks, bookings and anything else that needs a live check. The service worker caches only the anonymous `/field` page; no signed-in page or API response is cached.

## Assistance added to close the master prompt §37 gaps

All of these are worked out by rules from the platform's own records, work with no AI service connected, and decide nothing on anyone's behalf.

- **Listing checks for reviewers** (`/admin`, listings awaiting review): an asking price far from similar homes, contact details or "WhatsApp me" in the text, money asked before an inspection, a photo another company already uses (`listing_photos.content_hash`, set by the database), a description copied word for word, a company that joined in the last 14 days, and bursts of listings. Flagged listings are shown first; the reviewer still approves or returns each one.
- **What is different** (`/compare`): plain sentences on the cheapest yearly cost (rent plus service charge) or price, best value per m², each home against the typical asking figure for its bedrooms in its city, missing title documents, verified companies, furnishing and amenities only one has.
- **Help me write this** (property enquiry form): the visitor ticks what to ask (availability, inspection, the full fee breakdown, title document, payment plan, who owns it) and a message is written for them to edit. Nothing is ticked to start with.
- **Gone quiet** (`/app/crm`): open leads with no call, email, meeting or WhatsApp logged (not contacted a day after arriving, 14 days on an open lead, 7 when the client wants to move now) and no follow-up planned, with a one-step "Plan a follow-up".

## Accounting export

- **`/app/reports/accounting`** (finance roles): a period's rent billed, approved adjustments, receipts and reversals, deposits, and service charge billed, collected and spent, as balanced double-entry journals. Download with debit and credit columns or one signed amount column (`/app/reports/journal.csv`), for QuickBooks, Sage, Xero, Zoho Books or a spreadsheet.
- Rent on properties the company only manages goes to "Rent held for property owners", never to income; service charge moves the tenants' fund (master prompt §13.1). The company administrator sets its own account codes; the defaults are shown. Every download is logged.
- The platform does not claim to be the books of account (§13.3): the export is for posting and reconciling in the company's accounting package.

## Music on reels

- **Music library** (`/admin/music`, platform administrator only): upload songs the platform holds a licence for (MP3, M4A, AAC or OGG, up to 4 MB), with the licence's name, a link to it and notes, and whether the artist must be credited. Popular commercial songs need a licence from the labels and must not be added without one. Withdrawing a song stops it being chosen.
- **Posting a reel** (`/reels/new`): agents pick a song (search and filter by style, listen first), where in the song to start, and the volumes of the song and the clip's own sound, then preview both together before uploading.
- **Mixing**: the server lays the song under the clip with ffmpeg (installed by `deploy/ubuntu/install.sh`; set `FFMPEG_PATH`/`FFPROBE_PATH` if it is elsewhere), copying the picture without re-encoding. Where ffmpeg is missing or the result would pass 4 MB, the clip is kept as it is and the player plays the song alongside it, in step. Every reel shows the song's title and artist.
- The demo seeds four original instrumentals made with `npx tsx scripts/make-demo-music.ts`; replace them with licensed tracks before launch.
