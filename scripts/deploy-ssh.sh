#!/usr/bin/env bash
# Run on the GitHub runner after joining the Tailnet. No local builds.
set -euo pipefail
: "${DEPLOY_HOST:?Missing DEPLOY_HOST}"
: "${DEPLOY_USER:?Missing DEPLOY_USER}"
: "${DEPLOY_SSH_KEY:?Missing DEPLOY_SSH_KEY}"
: "${ORDERS_IMAGE:?Missing ORDERS_IMAGE}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
[[ "$DEPLOY_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || { echo 'Invalid DEPLOY_HOST' >&2; exit 1; }
[[ "$DEPLOY_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]] || { echo 'Invalid DEPLOY_USER' >&2; exit 1; }
[[ "$DEPLOY_PORT" =~ ^[0-9]{1,5}$ ]] && ((10#$DEPLOY_PORT > 0 && 10#$DEPLOY_PORT <= 65535)) || { echo 'Invalid DEPLOY_PORT' >&2; exit 1; }
[[ "$ORDERS_IMAGE" =~ ^ghcr\.io/[a-z0-9._/-]+:latest$ ]] || { echo 'Expected a GHCR image with the latest tag' >&2; exit 1; }
script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT
chmod 700 "$temporary"
printf '%s\n' "$DEPLOY_SSH_KEY" | tr -d '\r' > "$temporary/key"
chmod 600 "$temporary/key"
# Optional pinned server host keys. Otherwise trust the first key over the authenticated Tailnet.
if [[ -n "${DEPLOY_KNOWN_HOSTS:-}" ]]; then
    printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$temporary/known_hosts"
    host_check=yes
else
    touch "$temporary/known_hosts"
    host_check=accept-new
fi
# Use ordinary OpenSSH key authentication over Tailscale, not Tailscale SSH.
ssh -T -i "$temporary/key" -p "$DEPLOY_PORT" \
    -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=30 \
    -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
    -o "UserKnownHostsFile=$temporary/known_hosts" -o "StrictHostKeyChecking=$host_check" \
    "$DEPLOY_USER@$DEPLOY_HOST" \
    "ORDERS_IMAGE='$ORDERS_IMAGE' bash -s" < "$script_directory/start-docker.sh"
