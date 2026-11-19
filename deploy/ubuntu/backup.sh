#!/usr/bin/env bash
# Nightly database backup: a compressed custom-format dump, kept 14 days, plus an optional copy to another machine.
# To copy off the server set BACKUP_RSYNC_TARGET in /etc/housy/housy.env, for example "backup@other-host:/srv/housy-backups/".
# A backup that lives only on the same disk is not a backup.
set -euo pipefail
set -a; . /etc/housy/housy.env; set +a
DIR=/var/backups/housy
FILE=$DIR/estate-$(date -u +%Y%m%d-%H%M%S).dump
umask 077
su postgres -c "pg_dump -Fc estate" > "$FILE"
[ -s "$FILE" ] || { echo "empty backup" >&2; exit 1; }
chown housy:housy "$FILE"
find "$DIR" -name 'estate-*.dump' -mtime +14 -delete
if [ -n "${BACKUP_RSYNC_TARGET:-}" ]; then rsync -a --timeout=120 "$FILE" "$BACKUP_RSYNC_TARGET"; fi
echo "Backup written: $FILE ($(stat -c %s "$FILE") bytes)"
# Reel videos kept in the server folder (Admin, Settings, Video storage): copied as they are, only new files each night.
MEDIA="${MEDIA_DIR:-/var/lib/housy/media}"
if [ -d "$MEDIA" ] && [ -n "$(ls -A "$MEDIA" 2>/dev/null)" ]; then
  install -d -o housy -g housy -m 0750 "$DIR/media"
  rsync -a "$MEDIA/" "$DIR/media/"
  if [ -n "${BACKUP_RSYNC_TARGET:-}" ]; then rsync -a --timeout=600 "$DIR/media" "$BACKUP_RSYNC_TARGET"; fi
  echo "Media copied: $MEDIA"
fi
