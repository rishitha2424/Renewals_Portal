# Mobileum Horizon

> Enterprise renewals pipeline intelligence platform replacing manual spreadsheets with real-time analytics, automated Excel reconciliation, and executive reporting.

---

## Quick Start (Windows)

```powershell
# One command — installs dependencies, migrates database, and starts servers
.\start.ps1
```

Then open **http://localhost:5173** in your browser.

---

## Database Support & Setup (SQLite & PostgreSQL)

For Docker Compose, set `ADMIN_PASSWORD` and a stable, random `ADMIN_SECRET_KEY`
in the project `.env` before starting the backend. Compose passes these settings
to the container; `SECRET_KEY` does not configure administrator authentication.
After changing them, recreate the backend with `docker compose up -d --build backend`.
Set `ENVIRONMENT=production` when serving over HTTPS so admin cookies use Secure.

If both data loading and sign-in fail, check `/api/health` and `/api/admin/status`
through the same browser host and port as the app. Both must return JSON;
HTML indicates a missing API proxy. The status response's `is_configured` field
must be true for administrator sign-in. Keep the existing database volume when
recreating containers so uploaded snapshots remain available.

For the RHEL deployment at `~/renewals_data-main` with the virtual environment
in `.venv`, a user service is provided in `deploy/renewals-user.service`:

```bash
mkdir -p ~/.config/systemd/user
install -m 644 deploy/renewals-user.service ~/.config/systemd/user/renewals.service
systemctl --user daemon-reload
systemctl --user enable --now renewals.service
loginctl enable-linger "$USER"
```

Inspect this service with `systemctl --user status renewals` and
`journalctl --user -u renewals -n 60 --no-pager`. After changing `.env`, run
`systemctl --user restart renewals`. For the nginx deployment serving
`/usr/share/nginx/html/horizon`, publish a newly built frontend with:

```bash
sudo cp -R --no-preserve=context frontend/dist/. /usr/share/nginx/html/horizon/
sudo restorecon -RF /usr/share/nginx/html/horizon
```

Restore SELinux labels after publishing on RHEL. Copying with `cp -a` preserves
home-directory labels and can cause nginx to return 403 Forbidden.

Mobileum Horizon supports both **SQLite** (default for local zero-config development) and **PostgreSQL** (production & high-performance analytics).

### 1. SQLite (Default)
By default in `.env`:
```env
DATABASE_URL=sqlite:///./renewals.db
```
Startup will automatically run Alembic migrations on boot or create all tables.

### 2. PostgreSQL
To run on PostgreSQL:
1. Ensure PostgreSQL 14+ is running locally or remotely:
```powershell
# Example local Postgres connection string
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/renewals
```
2. Apply migrations:
```powershell
alembic upgrade head
```
3. Run automated tests against an isolated ephemeral PostgreSQL instance:
```powershell
python scripts/run_tests_on_postgres.py
```

---

## Manual Start (Two Terminals)

**Terminal 1 — Backend**
```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r backend\requirements.txt
uvicorn backend.main:app --reload --port 8000
```

**Terminal 2 — Frontend**
```powershell
cd frontend
npm install
npm run dev
```

---

## Running the Test Suites

### Backend Unit & Integration Tests (SQLite & Postgres)
```powershell
# Run backend pytest suite on SQLite
pytest backend/tests/ -v

# Run backend test suite on PostgreSQL
python scripts/run_tests_on_postgres.py
```

### Frontend Contract & Unit Tests
```powershell
cd frontend
# Run vitest suite
npm test

# Build production bundle
npm run build
```

---

## AI Configuration

By default, AI runs in **demo mode** (`DEMO_MODE=true` or when no API key is set) — no API key required, answering directly and deterministically from aggregated analytics tools and database benchmarks.

### External LLM Configuration (OpenAI-compatible)

To connect a company-approved OpenAI-compatible LLM endpoint, set the following in `.env`:

```env
DEMO_MODE=false
LLM_BASE_URL=https://api.openai.com/v1     # OpenAI-compatible completions endpoint
LLM_API_KEY=your_api_key_here             # Server-side only, never exposed to client
LLM_MODEL=gpt-4o-mini                    # Model name
LLM_TIMEOUT=30                           # Request timeout in seconds
LLM_MAX_TOOL_CALLS=6                     # Maximum tool execution iterations
LLM_SEND_MODE=aggregates                 # "aggregates" (default) | "full"
```

#### Privacy & Security Architecture (`LLM_SEND_MODE`)
- **`aggregates` (Default & Recommended)**: In this mode, only high-level summary figures, calculated totals, and top-5 opportunity snippets are sent to the external LLM endpoint. Raw opportunity rows, account lists, and sensitive deal details are stripped before transmitting tool responses.
- **`full`**: Sends complete tool outputs to the model. Use only with enterprise private-tenant endpoints approved for confidential commercial data.
- **Untrusted Data Boundary**: Tool outputs (opportunity names, account names) are treated as untrusted text to prevent prompt injection.
- **Read-Only Whitelist**: The LLM has zero SQL, shell, or filesystem access and can only invoke read-only functions with strict argument whitelisting.

---

## Folder Structure

```
Renewal_Data/
├── start.ps1               # one-command startup (Windows)
├── .env.example            # copy to .env
├── backend/
│   ├── main.py             # FastAPI entrypoint
│   ├── config.py           # all config from .env
│   ├── database.py         # SQLAlchemy sync engine
│   ├── models/             # ORM models (snapshot, opportunity, change_log, daily_summary)
│   ├── services/           # business logic (ingest, analytics, diff, ai, opportunities)
│   ├── routers/            # thin FastAPI routers
│   ├── utils/              # excel_parser, normalise
│   ├── seed.py             # loads real Excel files on first run
│   ├── requirements.txt
│   └── tests/              # pytest with Oct-5 reference assertions
├── frontend/
│   ├── src/
│   │   ├── pages/          # Dashboard, Pipeline, Opportunities, History, AI, Upload, Executive
│   │   ├── components/     # Shell, Sidebar, Topbar, CommandPalette, charts, ui
│   │   ├── design/tokens.ts
│   │   ├── store/appStore.ts
│   │   └── api/client.ts
│   └── package.json
├── data/
│   ├── Renewals Summary 3.xlsx
│   └── Renewal Comparison Tool 11.xlsx
└── assets/
    └── logo.png
```

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+K` / `⌘K` | Open command palette |
| `Ctrl+/` / `⌘/` | Toggle Data Assistant docked panel |
| `↑ ↓` | Navigate palette |
| `Enter` | Open selected page |
| `Esc` | Close palette or docked assistant |

---

## Architecture Notes

- **Immutable snapshots**: Every upload creates a new dated snapshot. Nothing is ever overwritten.
- **Service layer**: All business logic lives in `services/` and accepts `UserContext` — drop in auth/RBAC later without touching routers.
- **AI privacy**: Only aggregated numbers (total ACV, category counts) are sent to external AI providers — never raw rows.
- **Predictive insights**: Rule-based risk scoring with human-readable "why" factors. No fake ML. Shows "collecting history" until 7+ snapshots exist.
- **Executive View**: Uses browser `window.print()` with `@media print` CSS — no server-side PDF generation.
