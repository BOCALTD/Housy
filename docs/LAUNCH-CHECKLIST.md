# Launch checklist

Each line says who does it and how you know it is done. The page `/admin/launch` (platform administrators) shows which settings are in place; it cannot tell you a provider works, so each provider has a "prove it" step. Work top to bottom. Do not onboard a real company until every line in sections A to E is ticked.

## A. Hosting and database (you, in Vercel and Neon)
- [ ] Create the production Neon project and a **paid plan with point-in-time restore**. Note the history window.
- [ ] Create the Vercel project from the GitHub repository. Production branch: `main`.
- [ ] Add the domain; confirm HTTPS works and `http://` redirects to `https://`.
- [ ] Set the environment variables (the left column is the name):

| Name | Value | Notes |
|---|---|---|
| `DATABASE_URL`, `MIGRATION_DATABASE_URL` | Neon connection strings (pooled for the app, direct for migrations) | The deploy step creates the restricted `estate_app` role |
| `APP_DB_PASSWORD` | random, 24+ characters | |
| `MFA_ENCRYPTION_KEY` | random, 32+ characters | **Never change after people turn on two-step** |
| `REQUIRE_ADMIN_MFA` | `true` | |
| `SETUP_TOKEN` | random, 24+ characters | Remove after step A8 |
| `NEXT_PUBLIC_APP_URL` | `https://your-domain` | |
| `NEXT_PUBLIC_PLATFORM_NAME` | the final product name | |
| `CRON_SECRET`, `UNSUBSCRIBE_SECRET` | random, 24+ characters each | |
| `RESEND_API_KEY`, `EMAIL_FROM` | from the email provider | Sender domain verified (SPF, DKIM) |
| `PAYSTACK_SECRET_KEY` | live key, once the business account is approved | |
| `SUPPORT_EMAIL`, `SUPPORT_PHONE`, `SUPPORT_HOURS` | what users should call | Shown at `/support` |
| `ANTHROPIC_API_KEY` | optional | |
| `SEED_DEMO_DATA` | unset or `false` | |

- [ ] Deploy. The build applies migrations. Open `/api/health`: it answers `"ok":true`.
- [ ] Open `/setup` with the setup token and create the first platform administrator. Then **remove `SETUP_TOKEN`** and redeploy.
- [ ] A8: sign in as that administrator, open `/me/security`, turn on two-step sign-in, save the recovery codes somewhere safe (not on the same phone). Create a **second** platform administrator the same way, so one lost phone is not a lockout.
- [ ] Open `/admin/launch`. Every row is Ready, or you understand and accept each warning.

## B. Backups (you)
- [ ] In Neon, confirm point-in-time restore is on and note the window.
- [ ] Run `scripts/backup-restore-check.sh` against a copy of production (needs `pg_dump`). It must end with "Restored database matches the original".
- [ ] Do one **practice restore** by the steps in `RUNBOOK.md` section 3.4 into a Neon branch, and sign in to it. Write down how long it took.

## C. Email (you and the email provider)
- [ ] Add the schedules: copy the `crons` block from `vercel.cron.example.json` into a new `vercel.json` (notifications every 10 minutes, billing daily). The free Vercel plan allows daily schedules only; use `0 6 * * *` for both there. Vercel sends `CRON_SECRET` as the bearer token by itself.
- [ ] Use "Forgot password" on a real address you own. The email arrives within a few minutes and the link works once.
- [ ] `/api/health?detail=1` (with the cron secret) shows email queue empty.

## D. Payments (you and Paystack)
- [ ] Register the webhook address `https://your-domain/api/webhooks/paystack` in the Paystack dashboard.
- [ ] With the **test** key first: pay a test invoice; it shows paid, once, and the books check (`/admin/finance?check=1`) says Balanced.
- [ ] Switch to the live key. Pay one real small invoice with a real card, then refund it. Confirm the books check still says Balanced.
- [ ] If Paystack is not ready, launch with bank-transfer payments recorded by the administrator. Say so in the pilot brief.

## E. People and procedures (you)
- [ ] `ONBOARDING.md` read; the training session booked.
- [ ] `SUPPORT.md` read; someone named for each role in it; the support phone or inbox monitored.
- [ ] `ROLLBACK.md` read by whoever deploys.
- [ ] An uptime monitor on `/api/health`, alerting a phone that is answered.
- [ ] Privacy notice and terms written with a lawyer, linked where people register. (Not produced by this project.)

## F. Pilot (you and the pilot companies)
- [ ] Follow `PILOT.md`.

## G. Declare launch
- [ ] Write the date, the commit, and the names of the people who ticked A to E in the incident log.
