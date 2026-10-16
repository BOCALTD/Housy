# Running Housy on an Ubuntu server

Everything here is written for **Ubuntu 22.04 or 24.04** on one server you control (a VPS or your own machine). The files are in `deploy/ubuntu/`.

> **Honest status.** These scripts were written and syntax-checked, but **not yet run on a real Ubuntu server**. Expect to fix small things on the first run. Do the first install on a spare server and read each script before running it.

## What you get

```
Internet ── nginx (80/443, TLS) ──► Housy (Next.js, 127.0.0.1:3000) ──► PostgreSQL 16 (127.0.0.1:5432)
                                       ▲
              systemd timers: email queue every 10 min, billing daily, database backup nightly
```
Only SSH, HTTP and HTTPS are open (ufw). The app and database listen on the loopback only. nginx **overwrites** `X-Forwarded-For` with the real client address; the app's rate limits depend on it, so never let the app be reached except through nginx.

## What you must have first
- A server with 2 GB RAM or more (the build needs it), 20 GB disk or more, and root/sudo access.
- A domain whose DNS already points to the server's IP (TLS certificates need it).
- Your email and Paystack accounts when you are ready for them (the app runs without them; email waits in a queue).

## 1. One-time setup
Copy the repository to the server (or `git clone https://github.com/BOCALTD/Housy.git`) and run:
```
sudo bash deploy/ubuntu/install.sh your-domain.example you@your-domain.example
```
It installs Node 20, PostgreSQL 16, nginx, certbot, fail2ban and automatic security updates; creates a `housy` user, the database and a **generated `/etc/housy/housy.env`**; installs the service and timers; opens the firewall; and asks Let's Encrypt for a certificate. It prints the `SETUP_TOKEN`. It never overwrites an existing env file or database, so it is safe to run again.

Then edit `/etc/housy/housy.env`: product name, support contact, and the email/Paystack keys when you have them. **Back up `MFA_ENCRYPTION_KEY` somewhere safe**; changing it later disables two-step sign-in for everyone who uses it.

## 2. Deploy the code
```
sudo -u housy bash /opt/housy/deploy.sh main      # or a tag or commit
```
(install.sh does not copy it; run `sudo install -m 0755 -o housy deploy/ubuntu/deploy.sh /opt/housy/deploy.sh` once). Each deploy: clones into a new folder under `/opt/housy/releases/`, installs, runs `npm run db:setup` (creates the restricted `estate_app` role, applies migrations, grants privileges), builds, switches the `current` link, restarts the service and checks `/api/health`. **If the new version is not healthy within about a minute, it switches back to the previous release automatically.** The last five releases are kept.

Then open `https://your-domain/setup`, enter the setup token and create the first administrator. Remove `SETUP_TOKEN` from the env file and run `sudo systemctl restart housy`. Continue with `LAUNCH-CHECKLIST.md`.

## 3. Day to day
| Task | Command |
|---|---|
| Is it up | `curl -s https://your-domain/api/health` |
| App logs | `journalctl -u housy -f` |
| Restart | `sudo systemctl restart housy` |
| Timers | `systemctl list-timers 'housy-*'` |
| Run a job by hand | `sudo -u housy housy-job notifications` (or `billing`) |
| Backup now | `sudo housy-backup` |
| Database console | `sudo -u postgres psql estate` |
| Change a secret | edit `/etc/housy/housy.env`, then `sudo systemctl restart housy` (database password: see `RUNBOOK.md` 2.2) |

## 4. Backups: read this
- `housy-backup` writes a compressed dump to `/var/backups/housy/` every night at 02:30 and keeps 14 days.
- **A backup on the same disk is not a backup.** Set `BACKUP_RSYNC_TARGET` in the env file (for example `backup@other-host:/srv/housy-backups/`) so each dump is copied to another machine, ideally in another place. Set up SSH keys for the `root` user to that host. Without this, losing the server loses everything.
- You can restore to the **night** of a dump, not to a minute. That means you can lose up to a day of work. Closer than that needs PostgreSQL WAL archiving (point-in-time recovery), which is **not set up here**; it is a separate, careful job.
- Restore practice: `RUNBOOK.md` 3.4. Do one before launch.

## 5. What you now own (the trade-off of self-hosting)
- **One server is one point of failure.** If it is down, the site is down. No automatic failover.
- **You patch the system.** Security updates install automatically; kernel updates need an occasional reboot. A reboot restarts everything by itself (services are enabled), but check `/api/health` after.
- **You renew TLS.** certbot renews by timer; check `sudo certbot renew --dry-run` after setup.
- **You watch it.** Nothing alerts you. Point an uptime monitor (any free one) at `/api/health` and make it email or text you; check disk space (`df -h`) because uploaded documents live in the database.
- **Capacity.** One modest server is fine for a pilot; a load test has not been done (see `PERFORMANCE.md`).
- **Do not expose PostgreSQL.** Leave `listen_addresses` at its default and the firewall as installed.

## 6. Files
| File | Purpose |
|---|---|
| `install.sh` | one-time server setup |
| `deploy.sh` | build and switch to a new version, with automatic rollback |
| `housy.service` | systemd unit for the app (loopback only, hardened) |
| `nginx-housy.conf` | reverse proxy; overwrites the client address |
| `housy-*.timer/.service` | email queue (10 min), billing (daily 05:00), backup (02:30) |
| `job.sh`, `backup.sh` | installed as `housy-job`, `housy-backup` |
| `housy.env.example` | every setting, with notes |
