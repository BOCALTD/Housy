#!/usr/bin/env bash
# One-time server setup for Ubuntu 22.04 or 24.04. Run as root:  sudo bash install.sh your-domain.example admin@your-domain.example
# Installs Node 20, PostgreSQL 16, nginx and certbot, creates the service user, the database and a first env file, and
# a firewall that allows only SSH, HTTP and HTTPS. Safe to run again: it never overwrites an existing env file or database.
set -euo pipefail
DOMAIN=${1:?usage: install.sh DOMAIN ADMIN_EMAIL}
EMAIL=${2:?usage: install.sh DOMAIN ADMIN_EMAIL}
[ "$(id -u)" = 0 ] || { echo "Run as root (sudo)."; exit 1; }
HERE=$(cd "$(dirname "$0")" && pwd)

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg git ufw nginx certbot python3-certbot-nginx fail2ban unattended-upgrades openssl ffmpeg

# Node 20 (NodeSource)
if ! command -v node >/dev/null || ! node -v | grep -q '^v20'; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# PostgreSQL 16 (PGDG, so 22.04 and 24.04 get the same version)
if ! command -v psql >/dev/null || ! psql --version | grep -q ' 16\.'; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo $VERSION_CODENAME)-pgdg main" > /etc/apt/sources.list.d/pgdg.list
  apt-get update -y
  apt-get install -y postgresql-16
fi
systemctl enable --now postgresql

# Service user and folders
id housy >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/housy --shell /usr/sbin/nologin housy
install -d -o housy -g housy /opt/housy /opt/housy/releases /opt/housy/shared
install -d -o housy -g housy -m 0750 /var/backups/housy
install -d -m 0750 -o root -g housy /etc/housy

# Database and env file (only the first time)
if [ ! -f /etc/housy/housy.env ]; then
  gen() { openssl rand -hex "$1"; }
  OWNER_PW=$(gen 16); APP_PW=$(gen 16); MFA=$(gen 24); CRON=$(gen 16); UNSUB=$(gen 16); SETUP=$(gen 16)
  # Push notification keys (VAPID): a P-256 key pair, public and private halves as base64url.
  read -r VAPID_PUB VAPID_PRIV < <(node -e 'const {generateKeyPairSync}=require("crypto");const {privateKey}=generateKeyPairSync("ec",{namedCurve:"prime256v1"});const j=privateKey.export({format:"jwk"});console.log(Buffer.concat([Buffer.from([4]),Buffer.from(j.x,"base64url"),Buffer.from(j.y,"base64url")]).toString("base64url")+" "+j.d)')
  su postgres -c "psql -v ON_ERROR_STOP=1" <<SQL
CREATE ROLE estate_owner LOGIN PASSWORD '$OWNER_PW' CREATEROLE;
CREATE DATABASE estate OWNER estate_owner;
SQL
  sed -e "s/OWNER_PASSWORD/$OWNER_PW/g" \
      -e "s|APP_DB_PASSWORD=.*|APP_DB_PASSWORD=\"$APP_PW\"|" \
      -e "s|MFA_ENCRYPTION_KEY=.*|MFA_ENCRYPTION_KEY=\"$MFA\"|" \
      -e "s|CRON_SECRET=.*|CRON_SECRET=\"$CRON\"|" \
      -e "s|UNSUBSCRIBE_SECRET=.*|UNSUBSCRIBE_SECRET=\"$UNSUB\"|" \
      -e "s|SETUP_TOKEN=.*|SETUP_TOKEN=\"$SETUP\"|" \
      -e "s|VAPID_PUBLIC_KEY=.*|VAPID_PUBLIC_KEY=\"$VAPID_PUB\"|" \
      -e "s|VAPID_PRIVATE_KEY=.*|VAPID_PRIVATE_KEY=\"$VAPID_PRIV\"|" \
      -e "s|your-domain.example|$DOMAIN|" \
      "$HERE/housy.env.example" > /etc/housy/housy.env
  chown root:housy /etc/housy/housy.env; chmod 0640 /etc/housy/housy.env
  echo "Created /etc/housy/housy.env with generated secrets. Edit it to set the product name, support contact and providers."
  echo "SETUP_TOKEN for /setup (the first administrator): $SETUP"
  echo "MFA_ENCRYPTION_KEY is now fixed: back it up somewhere safe. Changing it later locks out everyone using two-step sign-in."
fi

# Service, proxy, timers
install -m 0644 "$HERE/housy.service" /etc/systemd/system/housy.service
install -m 0644 "$HERE"/housy-*.service "$HERE"/housy-*.timer /etc/systemd/system/
install -m 0755 "$HERE/backup.sh" /usr/local/bin/housy-backup
install -m 0755 "$HERE/job.sh" /usr/local/bin/housy-job
sed "s/your-domain.example/$DOMAIN/" "$HERE/nginx-housy.conf" > /etc/nginx/sites-available/housy
ln -sf /etc/nginx/sites-available/housy /etc/nginx/sites-enabled/housy
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
systemctl daemon-reload
systemctl enable housy-notifications.timer housy-push.timer housy-billing.timer housy-backup.timer

# Let the deploy user restart only this service (deploy.sh needs it)
echo 'housy ALL=(root) NOPASSWD: /usr/bin/systemctl restart housy' > /etc/sudoers.d/housy
chmod 0440 /etc/sudoers.d/housy; visudo -cf /etc/sudoers.d/housy

# Firewall: SSH, HTTP, HTTPS only. The database and the app listen on the loopback and are not reachable from outside.
ufw allow OpenSSH; ufw allow 'Nginx Full'; ufw --force enable
systemctl enable --now fail2ban unattended-upgrades

# TLS (needs the domain's DNS to already point at this server)
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect || echo "certbot failed: point DNS at this server and run: certbot --nginx -d $DOMAIN"

echo
echo "Server ready. Next: deploy the code with  sudo -u housy /path/to/deploy.sh <git-ref>   (see docs/UBUNTU.md)."
