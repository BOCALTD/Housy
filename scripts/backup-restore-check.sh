#!/usr/bin/env bash
# Prove that a backup can actually be restored: dump a database, restore it into a fresh one, and compare every table's row
# count, the row-level-security settings, and the money totals. Prints how long each step took, which is the recovery time
# for a database of this size. Usage: scripts/backup-restore-check.sh SOURCE_DB [RESTORED_DB]
# Connection settings come from the usual PG* environment variables.
set -euo pipefail
SRC=${1:?usage: backup-restore-check.sh SOURCE_DB [RESTORED_DB]}
DST=${2:-${SRC}_restored}
DIR=$(mktemp -d)
trap 'rm -rf "$DIR"' EXIT

now() { date +%s.%N; }
t0=$(now)
pg_dump -Fc -d "$SRC" -f "$DIR/backup.dump"
t1=$(now)
dropdb --if-exists "$DST"
createdb "$DST"
# A newer pg_restore than the server (as on CI runners) writes settings an older server does not know, such as
# transaction_timeout (PostgreSQL 17+). Restore through psql and drop those lines, so client and server versions may differ.
pg_restore --no-owner --no-privileges -f - "$DIR/backup.dump" | sed -e '/^SET transaction_timeout/d' | psql -X -q -v ON_ERROR_STOP=1 -d "$DST" > /dev/null
t2=$(now)

summary() {
  psql -X -A -t -d "$1" <<'SQL'
SELECT 'rows ' || table_name || ' ' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I', table_name), false, true, '')))[1]::text
  FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name;
SELECT 'rls ' || c.relname || ' ' || c.relrowsecurity || ' ' || c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname;
SELECT 'policies ' || count(*) FROM pg_policies WHERE schemaname = 'public';
SELECT 'constraints ' || count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public';
SELECT 'indexes ' || count(*) FROM pg_indexes WHERE schemaname = 'public';
SELECT 'receipts_kobo ' || coalesce(sum(amount_kobo), 0) FROM receipts;
SELECT 'rent_payments_kobo ' || coalesce(sum(amount_kobo), 0) FROM rent_payments;
SELECT 'rent_charged_kobo ' || coalesce(sum(amount_kobo), 0) FROM rent_charges;
SELECT 'migrations ' || count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;
SQL
}
summary "$SRC" > "$DIR/src.txt"
summary "$DST" > "$DIR/dst.txt"

SIZE=$(stat -c %s "$DIR/backup.dump")
TABLES=$(grep -c '^rows ' "$DIR/src.txt")
ROWS=$(grep '^rows ' "$DIR/src.txt" | awk '{s+=$3} END {print s+0}')
BACKUP_S=$(echo "$t1 - $t0" | bc -l | xargs printf '%.1f')
RESTORE_S=$(echo "$t2 - $t1" | bc -l | xargs printf '%.1f')
LINE="Backup: $SIZE bytes, $TABLES tables, $ROWS rows. Dump took ${BACKUP_S}s, restore took ${RESTORE_S}s."
echo "$LINE"; echo "::notice title=Backup and restore::$LINE"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf '## Backup and restore\n\n%s\n' "$LINE" >> "$GITHUB_STEP_SUMMARY"

if ! diff "$DIR/src.txt" "$DIR/dst.txt"; then
  echo "BACKUP CHECK FAILED: the restored database differs from the original." >&2
  exit 1
fi
[ "$TABLES" -gt 50 ] || { echo "BACKUP CHECK FAILED: only $TABLES tables found, the source looks empty." >&2; exit 1; }
echo "Restored database matches the original: every table's rows, security settings and money totals agree."
dropdb "$DST"
