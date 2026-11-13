#!/usr/bin/env bash
# Every message and window on every screen size, against the built app (started here if nothing is running).
set -u
if ! curl -s -o /dev/null http://localhost:3100/; then
  npx next start -p 3100 > server-states.log 2>&1 &
  for i in $(seq 1 40); do curl -s -o /dev/null http://localhost:3100/ && break; sleep 1; done
fi
npx tsx scripts/states-check.ts
