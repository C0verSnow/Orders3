#!/bin/sh
set -e
# Keep the established server CLI usable without a graphical session.
cat > /usr/bin/orders3 <<'WRAPPER'
#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    --no-browser|--list|--fetch-only|--help|-h|--version|-v)
      exec /opt/Orders3/resources/service/orders-service "$@" ;;
  esac
done
exec /opt/Orders3/orders3-desktop "$@"
WRAPPER
chmod 755 /usr/bin/orders3
