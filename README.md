# Household Expense Tracker

A mobile-friendly shared household expense tracker for two authenticated users, built as a static frontend with Supabase authentication + Postgres + Row Level Security (RLS).

## Why this architecture

This project uses a static JavaScript frontend and Supabase backend instead of Node.js/Spring because it is the simplest maintainable option that still gives:

- Separate sign-in per person
- Shared real-time-ish cloud data
- Strong database-level access controls (RLS)
- No custom backend server to maintain

## Features

- Fast expense entry with category + classification (`essential`, `reducible`, `optional`)
- Income tracking (salary/other), including one-off and recurring income
- Recurring expenses (mortgage, electricity, broadband, subscriptions, etc.)
- Dashboard-first view:
  - total monthly income and expenses
  - essential/reducible/optional monthly totals
  - monthly surplus/shortfall
  - category/classification/person breakdowns
  - income and expense trends
- "What If?" planner:
  - both incomes, one-income, or custom income scenarios
  - optional spending reduction simulation
  - projected surplus/shortfall
- Budget discovery from actual history:
  - average monthly spending
  - minimum essential monthly spending
  - average optional spending
  - irregular annual expenses converted to monthly equivalents
  - suggested monthly target
- Optional category budgets
- EUR formatting with Ireland locale (`en-IE`)
- CSV and Excel export
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
- Supabase RLS policies enforce that only household members can read/write household incomes, expenses, recurring items, and budgets.
- Data isolation is enforced in database policies, not hidden frontend routes.
- Join flow enforces max two authorized household members.
- No service-role keys are used in frontend.

## Backup/restore

- **Backup JSON** exports incomes, expenses, recurring data, and budgets.
- **Restore JSON** validates household ID and upserts records.
- **Export CSV/Excel** gives spreadsheet-friendly copies.

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
