# Production Deployment Guide

This guide details the step-by-step procedure for deploying the **Mobileum Horizon Renewal Data Platform** to a Linux production server (Ubuntu 22.04/24.04 LTS or Debian 12).

---

## 1. Prerequisites & Version Requirements

- **Python**: `3.11`, `3.12`, or `3.13` (with `python3-venv` and `python3-pip`)
- **Node.js & npm**: Node.js `18.x` or `20.x` LTS and npm `9.x`+
- **PostgreSQL**: PostgreSQL `14`, `15`, or `16`
- **Reverse Proxy**: Nginx `1.18`+
- **Process Manager**: systemd

---

## 2. PostgreSQL Database Setup

Connect to PostgreSQL as the `postgres` administrative user:

```bash
sudo -u postgres psql
```

Create the application database, dedicated user, and grant privileges:

```sql
-- 1. Create database user with a secure password
CREATE USER renewals_user WITH ENCRYPTED PASSWORD 'change_this_db_password_in_prod';

-- 2. Create the production database owned by renewals_user
CREATE DATABASE renewals_prod OWNER renewals_user;

-- 3. Grant schema permissions
\c renewals_prod
GRANT ALL ON SCHEMA public TO renewals_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO renewals_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO renewals_user;
\q
```

---

## 3. Step-by-Step Deployment Procedure

### Step 1: Clone Repository & Create Application User
```bash
# Create dedicated system user
sudo useradd -m -s /bin/bash renewals
sudo su - renewals

# Clone repository into application directory
git clone https://github.com/RishithaThoka/renewals_data.git /home/renewals/app
cd /home/renewals/app
```

### Step 2: Configure Production Environment (`.env`)
```bash
cp .env.example .env
chmod 600 .env
nano .env
```
Ensure the following production values are configured:
```ini
ENVIRONMENT=production
DATABASE_URL=postgresql://renewals_user:change_this_db_password_in_prod@localhost:5432/renewals_prod
PORT=8000
ADMIN_PASSWORD=your_strong_admin_password
ADMIN_SECRET_KEY=generate_with_openssl_rand_hex_32
COOKIE_SECURE=true
CORS_ORIGINS=["https://renewals.yourcompany.com"]
```

### Step 3: Python Environment & Dependencies
```bash
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### Step 4: Build Frontend Production Assets
```bash
cd frontend
npm ci
npm run build
cd ..
```
*Note: The FastAPI backend automatically serves the compiled SPA from `frontend/dist` with fallback to `index.html`.*

### Step 5: Run Database Migrations
```bash
# Apply all database migrations up to head
alembic upgrade head
```

---

## 4. Production Systemd Service

Create the systemd service file at `/etc/systemd/system/renewals.service`:

```ini
[Unit]
Description=Renewals Data Platform (FastAPI + React)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=renewals
Group=renewals
WorkingDirectory=/home/renewals/app
EnvironmentFile=/home/renewals/app/.env
ExecStart=/home/renewals/app/venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 4 --proxy-headers --forwarded-allow-ips='*'
Restart=always
RestartSec=5s
KillSignal=SIGTERM
TimeoutStopSec=30s
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable renewals
sudo systemctl start renewals
sudo systemctl status renewals
```

---

## 5. Nginx Reverse Proxy Configuration

Create `/etc/nginx/sites-available/renewals.conf`:

```nginx
server {
    listen 80;
    server_name renewals.yourcompany.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name renewals.yourcompany.com;

    # TLS Certificates
    ssl_certificate /etc/letsencrypt/live/renewals.yourcompany.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/renewals.yourcompany.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Allow large Excel snapshot workbook uploads (up to 100MB)
    client_max_body_size 100M;

    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Timeouts for heavy report generations
        proxy_connect_timeout 60s;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

Enable site and test configuration:
```bash
sudo ln -s /etc/nginx/sites-available/renewals.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 6. Health & Status Verification

Verify application status via `/api/health`:

```bash
curl -f https://renewals.yourcompany.com/api/health
```

Expected response payload:
```json
{
  "status": "ok",
  "version": "1.0.0",
  "database": {
    "dialect": "postgresql",
    "name": "renewals_prod",
    "connected": true,
    "migration_head": true
  }
}
```

---

## 7. Nightly Backup & Disaster Recovery

### Nightly PostgreSQL Dump Cron Job
Add a cron job under `renewals` user (`crontab -e`):

```bash
# Run backup nightly at 02:00 UTC and retain 30 daily copies
0 2 * * * /home/renewals/app/scripts/backup.sh >> /home/renewals/app/logs/backup.log 2>&1
```

The script `scripts/backup.sh` runs `pg_dump -F c -b -v` and automatically prunes snapshots older than 30 days.

### Database Restoration Procedure
To restore from a backup file:

```bash
# 1. Stop application server to prevent writes
sudo systemctl stop renewals

# 2. Restore database from selected dump file
/home/renewals/app/scripts/restore.sh /home/renewals/app/backups/renewals_prod_YYYYMMDD_HHMMSS.dump renewals_prod

# 3. Ensure migrations are up to date
cd /home/renewals/app && venv/bin/alembic upgrade head

# 4. Restart application server
sudo systemctl start renewals
```
