# Household Expense Tracker (Self-Hosted Secure Setup)

Mobile-friendly shared expense tracker for two household members, with separate login accounts and one shared household dataset.

## Architecture choice

This version uses:

- **Frontend:** Vite + Vanilla JavaScript + CSS
- **Backend:** Node.js (Express)
- **Database:** PostgreSQL (self-hosted) with **Row Level Security (RLS)**

Why this choice: it satisfies your requirement for strong privacy/security with database-enforced access rules, while keeping the stack maintainable.

## Features included

- Separate sign-in for each person
- Quick entry fields: amount, date, category, description, who paid, optional notes
- Add / edit / delete expenses
- Search + filters (text/category/person/month)
- Dashboard:
  - This month total
  - Spending by category
  - Spending by person
  - 6-month spending trend
- Monthly budget with clear status:
  - On track
  - Approaching budget (>=80%)
  - Budget exceeded
- EUR currency with Ireland-friendly date formatting (`en-IE`)
- CSV export
- JSON backup and restore

## Security model

- Authentication uses hashed passwords (`bcrypt`), never plaintext.
- API issues signed JWT tokens.
- Every DB request sets authenticated user context (`app.current_user_id`).
- PostgreSQL **RLS policies** enforce that only household members can read/write household data.
- Unauthorized users cannot access `/api/*` protected routes.
- No secrets are committed to Git.

## Project structure

- `src/` – frontend
- `server/src/` – API server
- `server/db/init/` – PostgreSQL bootstrap + schema + RLS policies
- `docker-compose.yml` – self-hosted local/prod base stack
- `Dockerfile` – builds frontend and backend into one app image

## Quick start (Docker)

1. Install Docker Desktop.
2. In project root:

```bash
docker compose up --build
```

3. Open:

- App: `http://localhost:4000`
- API health: `http://localhost:4000/api/health`

## Development mode (without Docker)

### Backend

1. Create PostgreSQL database and run SQL scripts in `server/db/init` in order.
2. Create `server/.env` from `server/.env.example`.
3. Run:

```bash
cd server
npm install
npm run dev
```

### Frontend

In root:

```bash
npm install
npm run dev
```

Vite proxies `/api` to `http://localhost:4000`.

## First use

1. Create account 1 and sign in.
2. Create household and budget.
3. Create account 2 and sign in.
4. Join household with invite code shown in account 1.
5. Add expenses from both accounts and confirm shared visibility.

## Backup and restore

- **Backup JSON:** includes household budget + expenses.
- **Restore JSON:** validates household and upserts records.
- **Export CSV:** downloadable copy for your own records.

## Self-host deployment options

- VPS + Docker Compose (recommended for full control)
- Home server / NAS with Docker
- Any container host where you manage Postgres + app secrets

Use HTTPS and rotate JWT/database secrets in production.

## Free-tier guidance

Self-hosted means no managed-service free-tier lock-in, but you pay for whichever host you choose (or use your own hardware).  
If you want a fully free internet-facing deployment, you usually need managed PaaS accounts; this self-hosted setup intentionally avoids that dependency.
