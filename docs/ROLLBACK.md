# Rollback and recovery plan

Three different things can go wrong after a change. Use the matching route.

## 1. A bad deploy (the code is wrong, the data is fine)
This is the common case and the cheapest to fix.
1. `deploy.sh` already switches back by itself when a new version fails its health check. To go back by hand: `ls /opt/housy/releases`, then as the `housy` user `ln -sfn /opt/housy/releases/<good-folder> /opt/housy/current.new && mv -T /opt/housy/current.new /opt/housy/current`, then `sudo systemctl restart housy`. No rebuild is needed; the last five releases are kept.
2. Check `/api/health` and sign in.
3. Fix the code on a branch, let CI go green, and deploy again.

Caveat: a rollback restores old **code**, not the database. If the bad deploy also ran a migration, check section 2 before switching to an old release, because old code may not understand the new tables.

## 2. A bad migration (the database shape is wrong)
Migrations here only **add** things (columns, tables, indexes) and never drop data, so old code keeps working with a newer database. That is deliberate: it makes rolling the code back safe. Rules for every migration from now on:
- Add, then use, then (much later, in a separate release) remove. Never rename or drop a column in the same release that stops using it.
- Each migration is applied in CI to a fresh database and checked against the Prisma schema. (CI does not test it against a copy of production data; for a risky migration, restore last night's backup to a scratch database and rehearse it there first.)
- If a migration fails midway on production, it is not marked applied; fix it and deploy again. Do not edit an applied migration; add a new one.

If a migration added something harmful (for example a constraint that blocks real data), write a new migration that removes the constraint, test it in CI, deploy. Do not edit production by hand unless the site is down, and if you do, write the exact statement in the incident log and put the same change into a migration afterwards.

## 3. Bad or lost data (someone deleted or overwrote records, or the database is damaged)
Follow `RUNBOOK.md` section 3.4: restore the last good backup into a **new database**, inspect it, then point the app at it or copy specific rows back. You can restore to the time of a nightly dump, not to the minute. Never restore over production.

Money tables are append-only (the app cannot update or delete them), so wrong money is corrected by new entries, not by restoring. Restore only for damage that bypassed the application.

## Decision table
| Symptom | Do |
|---|---|
| Site errors right after a deploy | 1 |
| Deploy fails at the migration step | 2 (nothing changed in production; fix and redeploy) |
| Pages work but one feature misbehaves for everyone | 1, then fix forward |
| Data missing or changed and nobody can say why | Incident level 1; contain; then 3 |
| One company says its numbers are wrong | Not a rollback. Check the activity log and ledger; `SUPPORT.md` |

## After any rollback
Write it in the incident log: what, when, who, why, what was lost (nothing, or the work between two times). Tell affected companies in plain words.
