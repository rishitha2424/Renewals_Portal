#!/usr/bin/env bash
# start.sh — Production startup script for Renewals Data Platform
# Stops execution immediately if any command returns a non-zero exit code.
set -euo pipefail

# Determine port from PORT environment variable (defaults to 8000)
PORT="${PORT:-8000}"

echo "=== Starting Renewals Data Platform ==="
echo "Port: ${PORT}"

# 1. Install / update Python dependencies
echo "Installing Python requirements..."
pip install --upgrade pip
pip install -r requirements.txt

# 2. Build frontend if production bundle (frontend/dist) is missing
if [ ! -d "frontend/dist" ] || [ ! -f "frontend/dist/index.html" ]; then
    echo "Frontend build missing. Building frontend production bundle..."
    (
        cd frontend
        npm ci || npm install
        npm run build
    )
    echo "Frontend build completed successfully."
else
    echo "Existing frontend production bundle detected in frontend/dist."
fi

# 3. Start production ASGI server with uvicorn
echo "Launching Uvicorn server on 0.0.0.0:${PORT}..."
exec uvicorn backend.main:app --host 0.0.0.0 --port "${PORT}"
