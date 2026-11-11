# Household Finance Tracker (GitHub Pages only)

Simple household income/expense tracker with four tabs:
- Dashboard
- Transactions
- Financial Groups
- What If?

## Plain data/storage facts

- This app is hosted as static files on GitHub Pages.
- **Entries are saved in browser local storage on each device**.
- It does **not** auto-sync between devices.
- Your data is **not** committed to the repository unless you manually export and commit it.
- Use **Backup JSON** and **Restore JSON** to move/recover data.

## Access screen

- Playful entry screen asks for name and "DOB".
- Expected DOB is today's date.
- This is **not security/authentication**.

## Features

- Two quick actions: **Add Income** and **Add Expense**
- Entry fields:
  - amount
  - date
  - category
  - frequency
  - optional note/description
  - optional financial group
- Frequencies:
  - one-time
  - weekly
  - monthly
  - quarterly
  - yearly
  - custom-months (for irregular month-specific income/expense)
- Start/end dates for recurring entries
- Financial groups to link items (for example rental income + mortgage + maintenance)
- Expense classes: mandatory, reducible, optional
- Separate:
  - **Actual cash flow** (when money really arrives/leaves)
  - **Normalised monthly view** (planning averages)
- What-if planner:
  - remove income streams
  - override income values
  - reduce optional expenses
  - see monthly/annual surplus/shortfall without changing stored entries
- CSV/Excel export and JSON backup/restore

## Run locally

```bash
npm install
npm run dev
```

## Deploy to GitHub Pages

This repo includes `.github/workflows/deploy-pages.yml`.

1. GitHub repo settings -> Pages -> Source = GitHub Actions
2. Push to `master`
3. Live URL:
   `https://ranjana7.github.io/household-expense-tracker/`
