#!/usr/bin/env bash
# ==============================================================================
# deploy/deploy.sh
# Production update & deployment script for Mobileum Horizon on RHEL / Linux VM
# ==============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$APP_DIR"
echo "=== Deploying Mobileum Horizon in: $APP_DIR ==="

# 1. Pull latest git changes for current branch
BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")}"
echo "=== Pulling latest changes from git (branch: $BRANCH) ==="
git pull origin "$BRANCH" || true

# 2. Activate or create Python virtual environment
if [ -d "$APP_DIR/venv" ]; then
    VENV_DIR="$APP_DIR/venv"
elif [ -d "$APP_DIR/.venv" ]; then
    VENV_DIR="$APP_DIR/.venv"
else
    echo "Creating virtual environment in $APP_DIR/venv..."
    python3 -m venv "$APP_DIR/venv"
    VENV_DIR="$APP_DIR/venv"
fi
source "$VENV_DIR/bin/activate"

echo "=== Updating Python dependencies ==="
pip install --upgrade pip
pip install -r requirements.txt

# 3. Run Alembic database migrations
echo "=== Running Alembic database migrations ==="
alembic upgrade head

# 4. Build frontend production bundle
echo "=== Building frontend production bundle ==="
if [ -d "$APP_DIR/frontend" ]; then
    cd "$APP_DIR/frontend"
    npm ci --silent || npm install --silent
    npm run build
    cd "$APP_DIR"
fi

# 5. Sync frontend to Nginx directories if standard paths exist
if [ -d "/usr/share/nginx/html/horizon" ]; then
    echo "Syncing frontend bundle to /usr/share/nginx/html/horizon..."
    sudo cp -R --no-preserve=context "$APP_DIR/frontend/dist/." /usr/share/nginx/html/horizon/
    sudo restorecon -RF /usr/share/nginx/html/horizon 2>/dev/null || true
elif [ -d "/usr/share/nginx/html" ] && [ -f "/etc/nginx/conf.d/default.conf" ]; then
    echo "Syncing frontend bundle to /usr/share/nginx/html..."
    sudo cp -R --no-preserve=context "$APP_DIR/frontend/dist/." /usr/share/nginx/html/
    sudo restorecon -RF /usr/share/nginx/html 2>/dev/null || true
fi

# 6. Configure SELinux permissions on RHEL
if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce 2>/dev/null)" != "Disabled" ]; then
    echo "=== Ensuring SELinux network connect permissions ==="
    sudo setsebool -P httpd_can_network_connect 1 2>/dev/null || true
    if [ -d "$APP_DIR/frontend/dist" ]; then
        sudo chcon -Rt httpd_sys_content_t "$APP_DIR/frontend/dist" 2>/dev/null || true
    fi
fi

# 7. Check Nginx configuration
if [ -d "/etc/nginx/conf.d" ]; then
    if [ ! -f "/etc/nginx/conf.d/renewals.conf" ] && [ ! -f "/etc/nginx/conf.d/default.conf" ]; then
        echo "Installing Nginx configuration to /etc/nginx/conf.d/renewals.conf..."
        sudo cp "$APP_DIR/deploy/nginx-renewals.conf" /etc/nginx/conf.d/renewals.conf
    fi
    if command -v nginx >/dev/null 2>&1; then
        sudo nginx -t && (sudo systemctl reload nginx 2>/dev/null || sudo systemctl restart nginx 2>/dev/null || true)
    fi
fi

# 8. Restart renewals service
echo "=== Restarting renewals systemd service ==="
if systemctl is-active --quiet renewals.service 2>/dev/null || [ -f "/etc/systemd/system/renewals.service" ]; then
    sudo systemctl restart renewals.service
elif systemctl --user is-active --quiet renewals.service 2>/dev/null; then
    systemctl --user restart renewals.service
else
    echo "Neither system nor user renewals.service found. Please start your backend with ./start.sh or systemctl."
fi

# 9. Health check
echo "=== Checking service health ==="
sleep 2
curl -fsS http://127.0.0.1:8000/api/health || curl -fsS http://127.0.0.1:8000/health || {
    echo "Health check failed after service restart! Inspect logs with: journalctl -u renewals.service -n 50 --no-pager"
    exit 1
}

echo "=== Deployment finished successfully ==="
