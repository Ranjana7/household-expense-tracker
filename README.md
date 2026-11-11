# Household Finance Tracker

Single-page household finance tracker with:
- Monthly/yearly dashboard
- Two tabs only: **Add Expense** and **Add Income**
- Playful welcome screen (name + DOB=today), explicitly not authentication

## Entry fields

### Add Expense
- Amount
- Expense date (defaults to today)
- Frequency: weekly / monthly / yearly
- Category
- Mandatory or avoidable
- Recurring: yes/no
- Optional note

### Add Income
- Amount
- Income date (defaults to today)
- Frequency: weekly / monthly / yearly
- Category
- Relates to Expense (optional text)
- Permanent or temporary
- Recurring: yes/no
- Optional note

## Dashboard metrics

- Monthly household income
- Gross expenses
- Income linked to expenses
- Net expenses after linked income
- Remaining household income
- Mandatory vs avoidable expenses
- Monthly/yearly toggle

Linked-income rule:
- Linked income reduces the effective cost of related expenses
- Household balance avoids double-counting:
  - `remaining household income = total income - gross expenses`
  - linked income is shown separately and used only for net-expense view

## Recurrence behavior

- Recurring entries repeat by selected frequency
- Non-recurring entries appear once
- Temporary recurring income is not projected beyond today

## GitHub-centric sync architecture support

The frontend supports two data modes:

1. **Shared sync mode** (for two-user live updates)
   - Set `VITE_SYNC_API_BASE_URL` at build time
   - Frontend reads/writes through secure API endpoint
   - Includes conflict-safe writes using revision checks (`If-Match`)
   - Polls for updates and refreshes shared data automatically

2. **Local fallback mode**
   - If API URL is not configured, data is saved to browser local storage
   - No automatic cross-device sync

## Backup and recovery

- Export JSON / CSV / Excel
- Restore JSON backup into the app

## Local run

```bash
npm install
npm run dev
```

## GitHub Pages deployment

1. Settings -> Pages -> Source = GitHub Actions
2. Push to `master`
3. Live URL:
   `https://ranjana7.github.io/household-expense-tracker/`

