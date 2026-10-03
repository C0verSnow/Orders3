#!/usr/bin/env bash
set -euo pipefail
build_directory="${1:-build/native}"
package_directory="${2:-dist/orders-linux-x64}"
cmake --install "$build_directory" --prefix "$package_directory"
mkdir -p "$package_directory/lib" "$package_directory/plugins/sqldrivers" "$package_directory/plugins/tls"
plugin_directory="$(qtpaths6 --plugin-dir)"
cp "$plugin_directory/sqldrivers/libqsqlite.so" "$package_directory/plugins/sqldrivers/"
cp "$plugin_directory/tls/"*.so "$package_directory/plugins/tls/"
# OpenSSL is loaded dynamically by Qt's TLS plugin, so ldd may not list it.
# Resolve its SONAMEs from the native runner's linker cache instead.
for library in libssl.so.3 libcrypto.so.3; do
    path="$(ldconfig -p | awk -v name="$library" '$1 == name && !found {print $NF; found=1}')"
    if [[ -z "$path" || ! -f "$path" ]]; then
        echo "Cannot locate required OpenSSL runtime library: $library" >&2
        exit 1
    fi
    cp -L "$path" "$package_directory/lib/"
done
# Collect transitive dependencies, retaining the target distribution's glibc as a system dependency.
queue=("$package_directory/bin/orders" "$package_directory"/plugins/*/*.so "$package_directory"/lib/*.so*)
while (("${#queue[@]}")); do
    current="${queue[0]}"
    queue=("${queue[@]:1}")
    while IFS= read -r dependency; do
        name="$(basename "$dependency")"
        case "$name" in
            libc.so.*|libm.so.*|libpthread.so.*|libdl.so.*|librt.so.*|ld-linux*) continue ;;
        esac
        if [[ ! -e "$package_directory/lib/$name" ]]; then
            cp -L "$dependency" "$package_directory/lib/$name"
            queue+=("$package_directory/lib/$name")
        fi
    done < <(ldd "$current" | awk '/=> \/.* / {print $3}')
done
patchelf --set-rpath '$ORIGIN/../lib' "$package_directory/bin/orders"
for library in "$package_directory"/lib/*.so*; do
    patchelf --set-rpath '$ORIGIN' "$library"
done
for plugin in "$package_directory"/plugins/*/*.so; do
    patchelf --set-rpath '$ORIGIN/../../lib' "$plugin"
done
cat > "$package_directory/bin/qt.conf" <<'CONF'
[Paths]
Prefix=..
Plugins=plugins
Libraries=lib
CONF
cp README.md docs/architecture.md docs/third-party.md "$package_directory/"
# Include license notices for the bundled Ubuntu libraries.
mkdir -p "$package_directory/licenses"
cp -R /usr/share/common-licenses "$package_directory/licenses/"
for notice in /usr/share/doc/libqt6*/copyright /usr/share/doc/libssl3*/copyright \
              /usr/share/doc/libstdc++6/copyright /usr/share/doc/libgcc-s1/copyright \
              /usr/share/doc/libsqlite3-0/copyright /usr/share/doc/zlib1g/copyright \
              /usr/share/doc/libicu*/copyright; do
    if [[ -f "$notice" ]]; then
        cp "$notice" "$package_directory/licenses/$(basename "$(dirname "$notice")").txt"
    fi
done
tar -C "$(dirname "$package_directory")" -czf "$package_directory.tar.gz" "$(basename "$package_directory")"
