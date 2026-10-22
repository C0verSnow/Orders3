#!/usr/bin/env bash
set -euo pipefail
arch="${1:?expected amd64 or arm64}"
export FILE_VERSION="${FILE_VERSION:-${2:-1.0.0}}"
case "$arch" in amd64) expected=x64 ;; arm64) expected=arm64 ;; *) exit 1 ;; esac
test "$(node -p process.arch)" = "$expected"
node scripts/package-desktop.mjs
cp "dist/desktop-release/orders3_${FILE_VERSION}_${arch}.deb" "dist/orders3_${FILE_VERSION}_${arch}.deb"
