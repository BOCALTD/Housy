#!/usr/bin/env bash
# Run Housy on your own Ubuntu computer (22.04 or 24.04, also Ubuntu on Windows / WSL), at http://localhost:3000. No domain or certificate needed.
#
#   bash scripts/ubuntu-local.sh            set everything up the first time, then start Housy
#   bash scripts/ubuntu-local.sh --demo     the same, with clearly labelled sample companies, homes and reels to explore
#   bash scripts/ubuntu-local.sh --lan      also open it to phones and laptops on your Wi-Fi (http://<this computer's IP>:3000)
#   bash scripts/ubuntu-local.sh --no-start set up and build only
#   bash scripts/ubuntu-local.sh --port 3001  use another port when 3000 is taken by another program
#   bash scripts/ubuntu-local.sh --rebuild  install and build again even if nothing changed
#
# Safe to run again: it keeps your database and your .env file and applies new migrations. When the code has not changed
# since the last build (no git pull), it skips installing and building and starts in seconds.
# For a public website with your own domain and HTTPS, use deploy/ubuntu/install.sh instead (docs/UBUNTU.md).
set -euo pipefail
DEMO=false; LAN=false; START=true; PORT=3000; REBUILD=false
while [ $# -gt 0 ]; do
  case "$1" in
    --demo) DEMO=true ;; --lan) LAN=true ;; --no-start) START=false ;; --rebuild) REBUILD=true ;;
    --port) shift; PORT="${1:-}"; [[ "$PORT" =~ ^[0-9]{2,5}$ ]] || { echo "Give a port number, for example --port 3001"; exit 1; } ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
  shift
done
cd "$(dirname "$0")/.."
say() { printf '\n\033[1;33m== %s\033[0m\n' "$*"; }
[ "$(id -u)" = 0 ] && { echo "Run this as your normal user, not with sudo (it asks for your password when it needs it)."; exit 1; }
command -v sudo >/dev/null || { echo "This needs sudo."; exit 1; }

# Check the port first, so a busy port is found before minutes of building, not after.
if $START && command -v ss >/dev/null && ss -ltn "( sport = :$PORT )" | grep -q LISTEN; then
  echo "Port $PORT is already in use by another program:"
  sudo ss -ltnp "( sport = :$PORT )" | tail -n +2 || true
  echo
  echo "Either stop it:          sudo fuser -k $PORT/tcp   (then run this again)"
  echo "or use another port:     bash scripts/ubuntu-local.sh --port $((PORT + 1))"
  exit 1
fi

# Already built from this exact code, port and address: start straight away.
STAMP="$(git rev-parse HEAD 2>/dev/null || echo nogit) port=$PORT lan=$LAN"
if ! $REBUILD && [ -f .env ] && [ -f .next/BUILD_ID ] && [ -f .next/housy-build-stamp ] && [ "$(cat .next/housy-build-stamp)" = "$STAMP" ] && command -v node >/dev/null && command -v psql >/dev/null; then
  FAST=true
else
  FAST=false
fi

if ! $FAST; then
say "Installing what Housy needs (Node.js 20, PostgreSQL 16, git, ffmpeg)"
export DEBIAN_FRONTEND=noninteractive
sudo sh -c 'echo "Acquire::Retries \"5\";" > /etc/apt/apt.conf.d/80housy-retries'
sudo apt-get update -y
sudo apt-get install -y curl ca-certificates gnupg git openssl ffmpeg
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
if ! command -v psql >/dev/null; then
  sudo install -d /usr/share/postgresql-common/pgdg
  sudo curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo "$VERSION_CODENAME")-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y postgresql-16
fi
fi # end of installing

# Start PostgreSQL. Ubuntu on Windows (WSL) may run without systemd; then the classic service command starts it.
if [ -d /run/systemd/system ]; then
  sudo systemctl enable --now postgresql
else
  sudo service postgresql start
  echo "(Ubuntu without systemd, e.g. on Windows: PostgreSQL does not start by itself after a restart; this script starts it each time.)"
fi
for i in $(seq 1 20); do sudo -u postgres psql -qtAc "select 1" >/dev/null 2>&1 && break; sleep 1; done
echo "Node $(node -v), $(psql --version)"

if [ ! -f .env ]; then
  say "Creating the database and your settings (.env)"
  gen() { openssl rand -hex "$1"; }
  OWNER_PW=$(gen 16); APP_PW=$(gen 16); ADMIN_PW=$(gen 8)
  if sudo -u postgres psql -qtAc "select 1 from pg_roles where rolname='estate_owner'" | grep -q 1; then
    sudo -u postgres psql -qc "ALTER ROLE estate_owner WITH LOGIN CREATEDB CREATEROLE PASSWORD '$OWNER_PW'"
  else
    sudo -u postgres psql -qc "CREATE ROLE estate_owner LOGIN CREATEDB CREATEROLE PASSWORD '$OWNER_PW'"
  fi
  sudo -u postgres psql -qtAc "select 1 from pg_database where datname='estate'" | grep -q 1 || sudo -u postgres psql -qc "CREATE DATABASE estate OWNER estate_owner"
  HOSTURL="http://localhost:$PORT"
  cat > .env <<EOF
# Made by scripts/ubuntu-local.sh for this computer. Keep it private: it holds passwords.
DATABASE_URL="postgresql://estate_owner:$OWNER_PW@127.0.0.1:5432/estate"
MIGRATION_DATABASE_URL="postgresql://estate_owner:$OWNER_PW@127.0.0.1:5432/estate"
APP_DB_PASSWORD="$APP_PW"
NEXT_PUBLIC_APP_URL="$HOSTURL"
NEXT_PUBLIC_PLATFORM_NAME="Housy"
MFA_ENCRYPTION_KEY="$(gen 24)"
CRON_SECRET="$(gen 16)"
UNSUBSCRIBE_SECRET="$(gen 16)"
REQUIRE_ADMIN_MFA=false
SEED_ADMIN_EMAIL="admin@housy.local"
SEED_ADMIN_PASSWORD="$ADMIN_PW"
SEED_DEMO_DATA=false
VERIFY_DECLINE_DAYS=90
VERIFY_LATER_HOURS=24
VERIFY_RECOMMEND_RENTALS=false
SUPPORT_EMAIL=""
LEGAL_ENTITY_NAME=""
LEGAL_ADDRESS=""
PRIVACY_EMAIL=""
EOF
  chmod 600 .env
  NEW_ADMIN=true
else
  echo "Keeping your existing .env and database."
  NEW_ADMIN=false
fi
set -a; . ./.env; set +a
if $LAN; then
  IP=$(hostname -I | awk '{print $1}')
  export NEXT_PUBLIC_APP_URL="http://$IP:$PORT"
else
  export NEXT_PUBLIC_APP_URL="http://localhost:$PORT"
fi

if $FAST; then
  say "Already built from this code: starting straight away"
  npm run db:setup >/dev/null
else
say "Installing the app's packages"
npm ci --include=dev --no-audit --no-fund --fetch-retries=6 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=180000

say "Preparing the database (secure app role, migrations)"
npm run db:setup
SEED_DEMO_DATA=$DEMO npm run db:seed

say "Building Housy (a few minutes the first time)"
npx prisma generate
NODE_ENV=production npx next build --webpack
echo "$STAMP" > .next/housy-build-stamp
fi

URL="${NEXT_PUBLIC_APP_URL}"
say "Ready"
echo "Open:      $URL"
echo "Admin:     ${SEED_ADMIN_EMAIL}"
if $NEW_ADMIN; then echo "Password:  ${SEED_ADMIN_PASSWORD}   (shown once here; it is also in .env until you change it)"; else echo "Password:  the one shown the first time (in .env as SEED_ADMIN_PASSWORD unless you changed it)"; fi
$DEMO && echo "Sample sign-ins: demo.seeker@example.test, demo.kemi.agent@example.test, demo.lekki@example.test (password demo-password-123)"
$LAN && echo "On your phone: connect to the same Wi-Fi and open $URL (allow the port if a firewall is on: sudo ufw allow $PORT/tcp)"
if $START; then
  echo "Stop with Ctrl+C. Start again later with:  bash scripts/ubuntu-local.sh$([ "$PORT" != 3000 ] && echo " --port $PORT")$($LAN && echo " --lan")"
  if $LAN; then H=0.0.0.0; else H=127.0.0.1; fi
  exec env NODE_ENV=production npx next start -H "$H" -p "$PORT"
fi
