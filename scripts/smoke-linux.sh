#!/usr/bin/env bash
set -euo pipefail
executable="$(realpath "${1:?Pass the C++ executable path}")"
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
for route in / /app.js /style.css /logo.svg /api/orders /api/schedule; do
    curl --fail --silent --show-error "$origin$route" > /dev/null
done
curl --fail --silent --show-error -H "Origin: $origin" -H 'Content-Type: application/json' \
    --data '{"enabled":false,"cron":"*/15 * * * *"}' "$origin/api/schedule"
test -f "$ORDERS_CONFIG_PATH"
test "$(curl --silent --output /dev/null --write-out '%{http_code}' \
    -H 'Origin: http://untrusted.example' -H 'Content-Type: application/json' \
    --data '{"enabled":false,"cron":"*/15 * * * *"}' "$origin/api/schedule")" = 403
test "$(curl --silent --output /dev/null --write-out '%{http_code}' \
    -H "Origin: $origin" -H 'Content-Type: application/json' \
    --data '{"enabled":true,"cron":"0 0 31 2 *"}' "$origin/api/schedule")" = 400
printf 'C++ runtime smoke checks passed\n'
