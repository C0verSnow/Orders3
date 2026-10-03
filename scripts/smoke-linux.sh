#!/usr/bin/env bash
set -euo pipefail
executable_path="${1:?Pass the C++ executable path}"
executable="$(cd "$(dirname "$executable_path")" && pwd)/$(basename "$executable_path")"
temporary="$(mktemp -d)"
export ORDERS_DATA_DIR="$temporary"
export ORDERS_CONFIG_PATH="$temporary/config"
export ORDERS_ALLOWED_ORIGIN="http://127.0.0.1:8090"
cd "$temporary"
"$executable" --cached --no-browser --port 8090 > runtime.log 2>&1 &
process=$!
trap 'kill "$process" 2>/dev/null || true; wait "$process" 2>/dev/null || true; cat runtime.log' EXIT
origin="http://127.0.0.1:8090"
curl --fail --silent --show-error --retry 30 --retry-delay 1 --retry-connrefused "$origin/api/data" > data.json
for route in / /app.js /ui.js /settings.js /schedule.js /startup.js /style.css /logo.svg /api/orders /api/schedule /api/settings; do
    curl --fail --silent --show-error "$origin$route" > /dev/null
done
curl --fail --silent --show-error -H "Origin: $origin" -H 'Content-Type: application/json' \
    --data '{"enabled":false,"cron":"*/15 * * * *"}' "$origin/api/schedule"
test -f "$ORDERS_CONFIG_PATH"
curl --fail --silent --show-error -H "Origin: $origin" -H 'Content-Type: application/json' \
    --data '{"SUPABASE_URL":"https://example.supabase.co","SUPABASE_ANON_KEY":"smoke-fixture-secret","API_SECRET":"smoke-gate-secret"}' \
    "$origin/api/settings" > settings.json
grep -q '"SUPABASE_ANON_KEY_SET":true' settings.json
if grep -q 'smoke-fixture-secret\|smoke-gate-secret' settings.json; then
    echo 'Settings API exposed secrets' >&2
    exit 1
fi
grep -q 'smoke-fixture-secret' "$ORDERS_CONFIG_PATH"
grep -q '\[schedule\]' "$ORDERS_CONFIG_PATH"
curl --fail --silent --show-error -H "Origin: $origin" -H 'Content-Type: application/json' \
    --data '{"enabled":false,"cron":"0 9 * * 1-5"}' "$origin/api/schedule" > /dev/null
grep -q 'smoke-fixture-secret' "$ORDERS_CONFIG_PATH"
test "$(curl --silent --output /dev/null --write-out '%{http_code}' \
    -H 'Origin: http://untrusted.example' -H 'Content-Type: application/json' \
    --data '{"API_SECRET":"replacement"}' "$origin/api/settings")" = 403
test "$(curl --silent --output /dev/null --write-out '%{http_code}' \
    -H 'Origin: http://untrusted.example' -H 'Content-Type: application/json' \
    --data '{"enabled":false,"cron":"*/15 * * * *"}' "$origin/api/schedule")" = 403
test "$(curl --silent --output /dev/null --write-out '%{http_code}' \
    -H "Origin: $origin" -H 'Content-Type: application/json' \
    --data '{"enabled":true,"cron":"0 0 31 2 *"}' "$origin/api/schedule")" = 400
printf 'C++ runtime smoke checks passed\n'
