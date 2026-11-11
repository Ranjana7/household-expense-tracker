# Household Expense Tracker

A mobile-friendly shared household expense tracker for two authenticated users, built as a static frontend with Supabase authentication + Postgres + Row Level Security (RLS).

## Why this architecture

This project uses a static JavaScript frontend and Supabase backend instead of Node.js/Spring because it is the simplest maintainable option that still gives:

- Separate sign-in per person
- Shared real-time-ish cloud data
- Strong database-level access controls (RLS)
- No custom backend server to maintain

## Features

- Quick expense entry: amount, date, category, description, who paid, optional notes
- Add, edit, delete, search, filter expenses
- Dashboard: this month total, by category, by person, 6-month trend
- Monthly budget with clear approaching/exceeded status
- EUR formatting with Ireland locale (`en-IE`)
- CSV export
- Backup and restore via JSON

## Stack

- Vite + Vanilla JavaScript + CSS
- Supabase Auth + Postgres + RLS

## Setup

1. Create a Supabase project.
2. In Supabase SQL editor, run `supabase/schema.sql`.
3. In Supabase Auth settings:
   - Enable Email/Password provider.
   - Set email confirmation as you prefer (on/off).
4. Copy `.env.example` to `.env.local` and fill:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

5. Install and run:

```bash
npm install
npm run dev
```

6. Open the app, create 2 user accounts, then:
   - First account: create household.
   - Second account: join with invite code shown in the app.

## Security model

- App access requires sign-in.
- Supabase RLS policies enforce that only household members can read/write that household's expenses and budget.
- Data isolation is enforced in database policies, not hidden frontend routes.
- No service-role keys are used in frontend.

## Backup/restore

- **Backup JSON** exports household budget + expenses.
- **Restore JSON** validates household ID and upserts records.
- **Export CSV** gives a spreadsheet-friendly copy.

## Deploy (private repo + free host)

Recommended: Netlify (free) connected to private GitHub repo.

- Build command: `npm run build`
- Publish directory: `dist`
- Environment variables:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`

## Free-tier limits (typical)

- **Supabase Free**: limited database size, auth quotas, and inactivity pausing.
- **Netlify Free**: limited monthly bandwidth/build minutes and project usage caps.

Check your provider dashboard for current exact quotas.
