#!/usr/bin/env bash
# Run a scheduled job in the app: housy-job notifications | billing. Uses the shared secret from the env file.
set -euo pipefail
JOB=${1:?job name}
set -a; . /etc/housy/housy.env; set +a
curl -fsS -m 120 -H "Authorization: Bearer ${CRON_SECRET}" "http://127.0.0.1:3000/api/cron/${JOB}" > /dev/null
