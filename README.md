# Household Expense Tracker

Private household finance tracker for two people, hosted on **GitHub Pages** with **Firebase Auth + Firestore**.

## Why this setup

- Public website URL on GitHub Pages
- Secure sign-in with email magic link
- Firestore security rules restrict data access to only two approved emails
- Real-time sync between both users' devices

## Features

- Expense tracking: add/edit/delete/search/filter
- Income tracking (salary/other)
- Essential/reducible/optional classification
- Dashboard with monthly totals, breakdowns, trends, and surplus/shortfall
- "What If?" one-income planner
- Recurring income and recurring expenses
- Category budgets
- EUR formatting (`en-IE`)
- CSV/Excel export + JSON backup/restore

## Local setup

1. Create a Firebase project.
2. Enable **Authentication → Email link (passwordless sign-in)**.
3. Create Firestore database (production mode).
4. In Firestore rules, paste `firebase/firestore.rules` and replace the two placeholder emails.
5. Copy `.env.example` to `.env.local` and fill Firebase values.
6. Set `VITE_APPROVED_USERS_JSON` with your two approved users and DOB hashes.
7. Run:

```bash
npm install
npm run dev
```

## How to generate DOB hashes (SHA-256)

Use format `YYYY-MM-DD` for DOB, then hash it:

```bash
node -e "const c=require('crypto'); console.log(c.createHash('sha256').update('1990-01-31').digest('hex'))"
```

Put that hash into `VITE_APPROVED_USERS_JSON`.

## GitHub Pages deploy

This repo includes `.github/workflows/deploy-pages.yml`.

1. In GitHub repo settings, enable **Pages → Source: GitHub Actions**.
2. Add repository secrets:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_APP_ID`
   - `VITE_HOUSEHOLD_ID`
   - `VITE_APPROVED_USERS_JSON`
3. Push to `master`.

Site URL format:

`https://ranjana7.github.io/household-expense-tracker/`

## Security model

- Sign-in required (magic link).
- Firestore rules enforce server-side email allow-list access.
- Only the two approved emails can read/write household data.
- No API secrets are committed in the repository.
