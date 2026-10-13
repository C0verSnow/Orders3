#!/usr/bin/env bash
# Compatibility entry point; the repository root script is the source of truth.
set -euo pipefail
script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$script_directory/../start-docker.sh" "$@"
