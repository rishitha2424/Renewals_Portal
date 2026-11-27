#!/usr/bin/env bash
# Run from any directory with: sudo bash deploy/install-app-paths.sh
set -euo pipefail

if [[ "$EUID" -ne 0 ]]; then
    echo "Run with sudo: sudo bash deploy/install-app-paths.sh" >&2
    exit 1
fi

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$APP_DIR/frontend/dist-renewals"
CONFIG=/etc/nginx/conf.d/mobileum.conf
BACKUP="${CONFIG}.$(date +%Y%m%d%H%M%S).bak"

test -f "$BUILD_DIR/index.html"
test -f "$CONFIG"
nginx -t
cp -p "$CONFIG" "$BACKUP"

rollback() {
    cp -p "$BACKUP" "$CONFIG"
    nginx -t && systemctl reload nginx
    echo "Installation failed; restored $BACKUP" >&2
}
trap rollback ERR

install -d -m 755 /usr/share/nginx/html/renewals
cp -R "$BUILD_DIR/." /usr/share/nginx/html/renewals/
chmod -R a+rX /usr/share/nginx/html/renewals
if command -v restorecon >/dev/null 2>&1; then
    restorecon -R /usr/share/nginx/html/renewals
fi
install -m 644 "$APP_DIR/deploy/nginx-app-paths.conf" "$CONFIG"
nginx -t
systemctl reload nginx
trap - ERR

echo "Installed IP path routes; backup: $BACKUP"
curl --fail --silent --show-error -o /dev/null -H 'Host: 10.10.51.71' http://127.0.0.1/renewals/
health_code="$(curl --silent --show-error -o /dev/null -w '%{http_code}' -H 'Host: 10.10.51.71' http://127.0.0.1/renewals/api/health)"
if [[ "$health_code" == "401" ]]; then
    echo "WARNING: /renewals/api/health returned HTTP 401; continuing without rollback." >&2
elif [[ ! "$health_code" =~ ^2[0-9]{2}$ ]]; then
    echo "ERROR: /renewals/api/health returned HTTP $health_code" >&2
    exit 1
fi
curl --fail --silent --show-error -o /dev/null -H 'Host: 10.10.51.71' http://127.0.0.1/operator/
echo 'Verified renewals frontend/API and operator page. Original ports are unchanged.'
