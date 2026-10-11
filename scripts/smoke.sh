#!/usr/bin/env bash
# Start the built app and check the main pages respond. Used by CI.
set -u
npx next start -p 3100 > server.log 2>&1 &
for i in $(seq 1 40); do curl -s -o /dev/null http://localhost:3100/ && break; sleep 1; done
fail() { echo "SMOKE FAILED: $1"; echo "--- server log ---"; tail -60 server.log; exit 1; }
code() { curl -s -o /dev/null -w '%{http_code}' "http://localhost:3100$1"; }

[ "$(code /setup)" = "200" ] || fail "/setup returned $(code /setup) before any admin exists"
curl -s http://localhost:3100/setup | grep -q "Create the platform administrator" || fail "/setup does not show the setup form"
npm run db:seed || fail "seed script failed"
[ "$(code /setup)" = "307" ] || fail "/setup returned $(code /setup) after an admin exists (expected redirect 307)"
curl -s http://localhost:3100/ | grep -q "DEMO" || fail "home page does not list demo properties"
[ "$(code /login)" = "200" ] || fail "/login returned $(code /login)"
[ "$(code /signup)" = "200" ] || fail "/signup returned $(code /signup)"
REF=$(curl -s http://localhost:3100/ | grep -o 'properties/PROP-[A-Z0-9]*' | head -1)
[ -n "$REF" ] || fail "no property link on the home page"
curl -s "http://localhost:3100/$REF" | grep -q "Verify this property" || fail "$REF has no verification link"
[ "$(code /app)" = "307" ] || fail "/app returned $(code /app) for a signed-out visitor (expected 307)"
echo "Smoke test passed"
