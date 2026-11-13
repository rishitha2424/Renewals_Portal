#!/usr/bin/env bash
# ==============================================================================
# deploy/setup_rhel.sh
# Complete One-Command Setup & Compatibility Script for RHEL Linux VM
# ==============================================================================
set -euo pipefail

echo "=== Mobileum Horizon RHEL Linux VM Setup ==="

# 1. Determine Application Directory
APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$APP_DIR"
echo "Application Directory: $APP_DIR"

# 2. Check and Install Required System Packages (dnf/yum)
if command -v dnf >/dev/null 2>&1; then
    PKG_MGR="dnf"
elif command -v yum >/dev/null 2>&1; then
    PKG_MGR="yum"
else
    PKG_MGR=""
fi

if [ -n "$PKG_MGR" ] && [ "$(id -u)" -eq 0 ]; then
    echo "=== Ensuring required system packages are installed ==="
    $PKG_MGR install -y python3 python3-pip python3-devel nginx curl git tar gcc || true
fi

# 3. Virtual Environment Setup
VENV_DIR="$APP_DIR/venv"
if [ ! -d "$VENV_DIR" ] && [ -d "$APP_DIR/.venv" ]; then
    VENV_DIR="$APP_DIR/.venv"
elif [ ! -d "$VENV_DIR" ]; then
    echo "Creating Python virtual environment in $VENV_DIR..."
    python3 -m venv "$VENV_DIR"
fi
source "$VENV_DIR/bin/activate"

# 4. Install / Update Python Requirements
echo "=== Installing Python dependencies ==="
pip install --upgrade pip
pip install -r "$APP_DIR/requirements.txt"

# 5. Environment File Verification
if [ ! -f "$APP_DIR/.env" ]; then
    echo "Creating .env from .env.example..."
    cp "$APP_DIR/.env.example" "$APP_DIR/.env"
    echo "Generated default .env. Please update DATABASE_URL, ADMIN_PASSWORD, and ADMIN_SECRET_KEY as needed."
fi

# 6. Database Migrations
echo "=== Running Alembic database migrations ==="
alembic upgrade head

# 7. Frontend Production Build
if [ -d "$APP_DIR/frontend" ]; then
    echo "=== Building frontend production bundle ==="
    cd "$APP_DIR/frontend"
    if command -v npm >/dev/null 2>&1; then
        npm ci --silent || npm install --silent
        npm run build
    else
        echo "WARNING: npm is not installed. If frontend/dist is present, existing build will be used."
    fi
    cd "$APP_DIR"
fi

# 8. SELinux & Firewall Configuration (RHEL specific)
if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce 2>/dev/null)" != "Disabled" ]; then
    echo "=== Configuring SELinux for Nginx reverse proxy ==="
    # Allow Nginx to connect upstream to 127.0.0.1:8000
    setsebool -P httpd_can_network_connect 1 2>/dev/null || true
    # Set web server file context on frontend dist
    if [ -d "$APP_DIR/frontend/dist" ]; then
        chcon -Rt httpd_sys_content_t "$APP_DIR/frontend/dist" 2>/dev/null || true
    fi
fi

if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld 2>/dev/null; then
    echo "=== Opening HTTP (80) in firewalld ==="
    firewall-cmd --permanent --add-service=http 2>/dev/null || true
    firewall-cmd --reload 2>/dev/null || true
fi

# 9. Configure Nginx
if [ -d "/etc/nginx/conf.d" ]; then
    echo "=== Configuring Nginx ==="
    # Create or update renewals.conf pointing to APP_DIR
    cat > /etc/nginx/conf.d/renewals.conf << NGINX_CONF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 100M;

    root $APP_DIR/frontend/dist;
    index index.html index.htm;

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files \$uri =404;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_connect_timeout 300s;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    location ~ ^/(health|api/health) {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location ~ ^/(docs|redoc|openapi\.json) {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location ~ ^/(compare|snapshots|upload) {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
NGINX_CONF

    nginx -t && systemctl enable --now nginx
    systemctl reload nginx 2>/dev/null || systemctl restart nginx 2>/dev/null || true
fi

# 10. Configure and Start Systemd Service
if [ -d "/etc/systemd/system" ] && [ "$(id -u)" -eq 0 ]; then
    echo "=== Configuring systemd service ==="
    cat > /etc/systemd/system/renewals.service << SYSTEMD_UNIT
[Unit]
Description=Mobileum Horizon Renewals Service
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=${SUDO_USER:-root}
Group=${SUDO_USER:-root}
WorkingDirectory=$APP_DIR
ExecStart=$VENV_DIR/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 1
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
SYSTEMD_UNIT

    systemctl daemon-reload
    systemctl enable --now renewals.service
    systemctl restart renewals.service
fi

# 11. Final Verification
echo "=== Verifying Health Endpoints ==="
sleep 2
if curl -fsS http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
    echo "[OK] Backend healthcheck passed at http://127.0.0.1:8000/api/health"
else
    echo "[WARNING] Backend not responding yet. Check logs: journalctl -u renewals.service -n 30 --no-pager"
fi

if curl -fsS http://127.0.0.1/api/health >/dev/null 2>&1; then
    echo "[OK] Nginx reverse proxy healthcheck passed at http://127.0.0.1/api/health"
else
    echo "[NOTE] Nginx healthcheck pending. Test with: curl http://127.0.0.1/api/health"
fi

echo "=============================================================================="
echo "Mobileum Horizon is ready! Access your portal at: http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost')"
echo "=============================================================================="
