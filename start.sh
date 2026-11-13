#!/usr/bin/env bash
# ==============================================================================
# start.sh — Production & local startup script for Renewals Data Platform
# ==============================================================================
set -euo pipefail

PORT="${PORT:-8000}"
HOST="${HOST:-0.0.0.0}"

echo "=== Starting Mobileum Horizon Renewals Platform ==="
echo "Host: ${HOST} | Port: ${PORT}"

# 1. Activate virtual environment if available and not already active
if [ -z "${VIRTUAL_ENV:-}" ]; then
    if [ -d "venv" ]; then
        source venv/bin/activate
    elif [ -d ".venv" ]; then
        source .venv/bin/activate
    fi
fi

# 2. Install / update Python dependencies
echo "Verifying Python dependencies..."
pip install --upgrade pip --quiet
pip install -r requirements.txt --quiet

# 3. Run Alembic database migrations
echo "Running database migrations..."
alembic upgrade head

# 4. Build frontend if production bundle (frontend/dist) is missing
if [ ! -d "frontend/dist" ] || [ ! -f "frontend/dist/index.html" ]; then
    echo "Frontend build missing. Building frontend production bundle..."
    (
        cd frontend
        npm ci --silent || npm install --silent
        npm run build
    )
    echo "Frontend build completed successfully."
else
    echo "Existing frontend production bundle detected in frontend/dist."
fi

# 5. Start ASGI server with uvicorn
echo "Launching Uvicorn server on ${HOST}:${PORT}..."
exec uvicorn backend.main:app --host "${HOST}" --port "${PORT}" --workers 1
