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
[ "$(code /join)" = "200" ] || fail "/join returned $(code /join)"
curl -s http://localhost:3100/pricing | grep -q "Everything included" || fail "/pricing does not compare the plans"
curl -s http://localhost:3100/market | grep -q "What property costs, city by city" || fail "/market does not render"
curl -s http://localhost:3100/field | grep -q "Opening the field kit" || fail "/field does not render"
curl -s http://localhost:3100/join | grep -q 'name="passwordConfirm"' || fail "/join does not ask for the password twice"
curl -s http://localhost:3100/login | grep -q 'Show password' || fail "/login has no show-password button"
[ "$(code /directory)" = "200" ] || fail "/directory returned $(code /directory) for a signed-out visitor"
[ "$(code /me)" = "307" ] || fail "/me returned $(code /me) for a signed-out visitor (expected 307)"
# Brand images: tab icon, home-screen icon, and the picture shown when a link is shared
for spec in "/icon.svg:image/svg" "/apple-icon.png:image/png" "/opengraph-image:image/png" "/twitter-image:image/png"; do
  path=${spec%%:*}; type=${spec#*:}
  ct=$(curl -s -o /tmp/brand.bin -w '%{http_code} %{content_type}' "http://localhost:3100$path")
  case "$ct" in "200 $type"*) ;; *) fail "$path did not return $type ($ct)";; esac
  [ -s /tmp/brand.bin ] || fail "$path is empty"
done
# The installable app: manifest, icons, service worker and the offline page
curl -s http://localhost:3100/manifest.webmanifest | grep -q '"display":"standalone"' || fail "manifest is missing or not standalone"
curl -s http://localhost:3100/ | grep -q 'rel="manifest"' || fail "home page has no manifest link"
for icon in /icons/icon-192.png /icons/icon-512.png /icons/maskable-512.png; do
  [ "$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "http://localhost:3100$icon")" = "200 image/png" ] || fail "$icon is not served as a PNG"
done
sw=$(curl -s -D /tmp/sw.h http://localhost:3100/sw.js)
echo "$sw" | grep -q 'credentials: "omit"' || fail "/sw.js is missing or does not fetch public pages anonymously"
grep -qi '^content-type: application/javascript' /tmp/sw.h || fail "/sw.js is not served as JavaScript"
grep -qi '^cache-control: no-cache' /tmp/sw.h || fail "/sw.js may be cached by the browser"
echo "$sw" | grep -q 'app|admin|me|portal|api' || fail "/sw.js does not exclude signed-in areas"
curl -s http://localhost:3100/offline | grep -q "You are offline" || fail "/offline does not render"
[ "$(code /calendar/not-a-real-token-at-all-xxxx.ics)" = "404" ] || fail "an unknown calendar link did not return 404"
[ "$(code /api/cron/push)" = "401" ] || fail "/api/cron/push answered without the job secret"
curl -s "http://localhost:3100/api/map/listings?bbox=3.5,2.5,14.5,15&zoom=6" | grep -q '"markers"' || fail "the map data endpoint did not answer"
[ "$(code '/api/map/listings?bbox=nonsense')" = "400" ] || fail "the map data endpoint accepted a bad area"
curl -s "http://localhost:3100/api/map/listings?near=6.45,3.47&km=20" | grep -q '"near"' || fail "radius search did not answer"
[ "$(code '/api/map/listings?near=6.45,3.47&km=7')" = "400" ] || fail "radius search accepted a radius it does not offer"
[ "$(code '/api/map/nearby?ref=nonsense')" = "400" ] || fail "the nearby endpoint accepted a bad reference"
[ "$(code '/api/map/travel?ref=PROP-NONE0000&from=6.5,3.3')" = "404" ] || fail "the travel endpoint answered for a property that does not exist"
curl -s -H "cf-ipcountry: GB" http://localhost:3100/map | grep -q "United Kingdom" || fail "the map did not open on the visitor's country"
curl -s http://localhost:3100/ | grep -q 'property="og:image"' || fail "home page has no og:image tag"
curl -s http://localhost:3100/ | grep -q 'rel="icon"' || fail "home page has no icon link"
REF=$(curl -s http://localhost:3100/ | grep -o 'properties/PROP-[A-Z0-9]*' | head -1)
[ -n "$REF" ] || fail "no property link on the home page"
P=${REF#properties/}
curl -s --max-time 45 "http://localhost:3100/api/map/nearby?ref=$P" | grep -q '"available"' || fail "the nearby endpoint did not answer for $P"
curl -s "http://localhost:3100/api/map/travel?ref=$P&from=6.6018,3.3515" | grep -q '"estimate"' || fail "the travel endpoint did not answer for $P"
curl -s "http://localhost:3100/$REF" | grep -q "Verify this property" || fail "$REF has no verification link"
# Sharing: the page has a share button, a preview picture of its own, and a guest is invited to sign up; a shared link returns to it.
page=$(curl -s "http://localhost:3100/$REF?shared=1")
echo "$page" | grep -q 'share-btn' || fail "$REF has no share button"
echo "$page" | grep -q "Someone shared this property with you" || fail "$REF does not greet a visitor who opened a shared link"
echo "$page" | grep -q "property=\"og:image\" content=\"[^\"]*/$REF/opengraph-image" || fail "$REF has no preview picture of its own"
ct=$(curl -s -o /tmp/share.png -w '%{http_code} %{content_type}' "http://localhost:3100/$REF/opengraph-image")
case "$ct" in "200 image/png"*) ;; *) fail "the preview picture for $REF did not render ($ct)";; esac
loc=$(curl -s -o /dev/null -w '%{redirect_url}' "http://localhost:3100/r/ABCDEFGH?to=%2F$(echo "$REF" | sed 's|/|%2F|')")
case "$loc" in *"/$REF?shared=1") ;; *) fail "a shared link did not lead back to $REF ($loc)";; esac
loc=$(curl -s -o /dev/null -w '%{redirect_url}' "http://localhost:3100/r/ABCDEFGH?to=%2F%2Fevil.example")
case "$loc" in *"/join") ;; *) fail "a shared link could lead off the site ($loc)";; esac
[ "$(code /app)" = "307" ] || fail "/app returned $(code /app) for a signed-out visitor (expected 307)"

# Signed-in pages: sign in as the demo administrator and the demo officer, and open every page against real data.
SESSION_OUT=$(npx tsx scripts/smoke-session.ts) || fail "could not create a smoke-test session: $SESSION_OUT"
TOKEN=$(echo "$SESSION_OUT" | sed -n 1p)
OFFICER_TOKEN=$(echo "$SESSION_OUT" | sed -n 2p)
SEEKER_TOKEN=$(echo "$SESSION_OUT" | sed -n 3p)
PLATFORM_TOKEN=$(echo "$SESSION_OUT" | sed -n 4p)
PAGES=$(echo "$SESSION_OUT" | tail -n +5)
[ -n "$TOKEN" ] && [ -n "$OFFICER_TOKEN" ] && [ -n "$SEEKER_TOKEN" ] && [ -n "$PLATFORM_TOKEN" ] && [ -n "$PAGES" ] || fail "smoke session output was empty"
COUNT=0
open_page() {
  local who="$1" cookie="$2" p="$3" status
  status=$(curl -s -o page.html -w '%{http_code}' -H "Cookie: sid=$cookie" "http://localhost:3100$p")
  [ "$status" = "200" ] || fail "$p returned $status for the $who"
  # The error and not-found pages are also embedded in every page's script data, so look for the
  # rendered heading element rather than the text.
  for marker in "<h1>Something went wrong</h1>" "<h1>Not found</h1>"; do
    if grep -qF "$marker" page.html; then
      echo "--- $p rendered: $marker (for the $who) ---"
      head -c 1500 page.html; echo
      fail "$p rendered an error page for the $who"
    fi
  done
  COUNT=$((COUNT + 1))
}
for p in $PAGES; do
  case "$p" in
    /me*|/portal*|/flatmates*|/directory*|/messages*|/referrals*|/rewards*|/vacancies*|/feedback*|/reviews*) open_page "seeker" "$SEEKER_TOKEN" "$p"; continue ;;
    /admin*) open_page "platform administrator" "$PLATFORM_TOKEN" "$p"; continue ;;
  esac
  open_page "administrator" "$TOKEN" "$p"
  # The officer cannot open settings, team or new-asset pages, which are limited to managers, or the sales pages, which are for agents and managers.
  case "$p" in
    /app/settings|/app/setup|/app/setup?*|/app/team|/app/import|/app/import/*|/app/verification|/app/api-keys|/app/portals|/app/portals/*|/app/bookings|/app/bookings/*|/app/safety/*|/app/assets/new|/app/crm|/app/crm/*|/app/deals|/app/deals/*|/app/sales|/app/sales/*|/app/commissions|/app/profile|/app/promotions|/app/reviews|/app/completed|/app/billing|/app/ads|/app/collaborations|/app/collaborations/*) ;;
    *) open_page "officer" "$OFFICER_TOKEN" "$p" ;;
  esac
done
echo "Opened $COUNT signed-in pages without errors"
echo "Smoke test passed"
