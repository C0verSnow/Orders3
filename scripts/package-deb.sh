#!/usr/bin/env bash
set -euo pipefail
arch="${1:?expected amd64 or arm64}"
version="${2:-1.0.0}"
case "$arch" in amd64) node_arch=x64 ;; arm64) node_arch=arm64 ;; *) exit 1 ;; esac
[[ "$version" =~ ^[0-9][0-9A-Za-z.+~:-]*$ ]]
test "$(node -p process.arch)" = "$node_arch"
binary="dist/orders-linux-$node_arch"
test -x "$binary"
stage="dist/deb-$arch"
mkdir -p "$stage/DEBIAN" "$stage/usr/bin" "$stage/usr/share/doc/orders3"
install -m 755 "$binary" "$stage/usr/bin/orders3"
install -m 644 README.md "$stage/usr/share/doc/orders3/README.md"
cat > "$stage/DEBIAN/control" <<EOF
Package: orders3
Version: $version
Architecture: $arch
Maintainer: Orders3 maintainers
Depends: libc6 (>= 2.39), libstdc++6, ca-certificates
Section: utils
Priority: optional
Description: Orders3 React and Node.js trading workspace
 Standalone trusted local service. Run orders3 to open your browser.
EOF
dpkg-deb --root-owner-group --build "$stage" "dist/orders3_${version}_${arch}.deb"
