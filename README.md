# Household Expense Tracker (Simple Public App)

A lightweight household expense tracker hosted on GitHub Pages.

## What this version is

- Public static website (no external backend service)
- Data saved in your browser (`localStorage`)
- Name + DOB popup gate for basic access friction
- Budget tracking, dashboard cards, filters, edit/delete, CSV/Excel export, JSON backup/restore

## Important limitation

This is **not secure authentication**.  
Because this app is fully client-side/public, name + DOB checks can be bypassed by technical users.

## Run locally

```bash
npm install
npm run dev
```

## Deploy to GitHub Pages

The workflow `.github/workflows/deploy-pages.yml` deploys automatically on push to `master`.

1. GitHub repo settings → **Pages** → Source = **GitHub Actions**
2. Push to `master`
3. Site URL:
   `https://ranjana7.github.io/household-expense-tracker/`

## Access popup logic

1. Enter one approved name (`Ranjana`/`Ranjana Garg` or `AK`/`AK Sharma`)
2. In DOB field, enter **today's date**
3. The app unlocks only when both checks match

## Data notes

- Data is stored per browser/device profile.
- Use **Backup JSON** and **Restore JSON** to move data between devices.
