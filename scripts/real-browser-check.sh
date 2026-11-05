#!/usr/bin/env bash
# Run the real-browser check against the built app, starting it if nothing is running.
set -u
if ! curl -s -o /dev/null http://localhost:3100/; then
  npx next start -p 3100 > server-real.log 2>&1 &
  for i in $(seq 1 40); do curl -s -o /dev/null http://localhost:3100/ && break; sleep 1; done
fi
npx tsx scripts/real-browser-check.ts
