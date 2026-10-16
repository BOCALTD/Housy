#!/usr/bin/env bash
# Deploy a version of the code. Run on the server as the housy user:  sudo -u housy bash deploy.sh <branch|tag|commit> [repo-url]
# Builds in a new release folder, applies database migrations, switches the "current" link, restarts the service and checks health.
# If the new version does not become healthy, the old link is restored and the old version restarted.
# Migrations only ever add (see docs/ROLLBACK.md), so the old code keeps working against the newer database.
set -euo pipefail
REF=${1:-main}
REPO=${2:-https://github.com/BOCALTD/Housy.git}
ROOT=/opt/housy
STAMP=$(date -u +%Y%m%d-%H%M%S)
DIR=$ROOT/releases/$STAMP
set -a; . /etc/housy/housy.env; set +a

echo "Fetching $REF"
git clone --quiet "$REPO" "$DIR"
git -C "$DIR" checkout --quiet "$REF"
cd "$DIR"
SHA=$(git rev-parse --short HEAD)
echo "Installing (commit $SHA)"
if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
echo "Preparing the database (runtime role, migrations, privileges)"
npm run db:setup
echo "Building"
npx prisma generate
npx next build

PREVIOUS=$(readlink -f $ROOT/current || true)
ln -sfn "$DIR" $ROOT/current.new && mv -T $ROOT/current.new $ROOT/current
echo "Restarting"
sudo systemctl restart housy

healthy() { for i in $(seq 1 30); do curl -fsS http://127.0.0.1:3000/api/health 2>/dev/null | grep -q '"ok":true' && return 0; sleep 2; done; return 1; }
if healthy; then
  echo "Healthy: $SHA is live."
  # Keep the last five releases.
  ls -1dt $ROOT/releases/* | tail -n +6 | xargs -r rm -rf
else
  echo "NOT healthy. Rolling back." >&2
  if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ]; then
    ln -sfn "$PREVIOUS" $ROOT/current.new && mv -T $ROOT/current.new $ROOT/current
    sudo systemctl restart housy
    healthy && echo "Rolled back to $(basename "$PREVIOUS")." || echo "Rollback also unhealthy: see journalctl -u housy." >&2
  fi
  exit 1
fi
