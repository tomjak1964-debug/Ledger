# Ledger — Quote-to-Cash

A single-file accounting app for a small industrial-controls shop: run the full
**quote → sales order → invoice → payment** cycle, plus payables and expenses. No build step,
no server, no account — open one HTML file in a browser and go. Data persists locally.

> **Stack at a glance:** single `.html` file · React 18 (UMD) + Babel Standalone · hand-written CSS ·
> `localStorage` persistence · zero build.

---

## Features

**Sell side**
- **Quotes** — dynamic line-item form, insert from a reusable item catalog, live totals, statuses
  (draft → sent → accepted → declined), search, and printable / PDF output.
- **Sales Orders** — created by accepting a quote and entering the customer PO#. Line items carry
  forward automatically.
- **Invoices** — generated from a sales order in one click; due dates set from your terms;
  printable / PDF; record payments.
- **Receivables** — A/R aging (current → 90+ days) and one-click payment recording.

**Spend side**
- **Payables** — vendor bills with A/P aging and payments.
- **Expenses** — logged by category with rollups.

**Everything else**
- **Dashboard** — a quote-to-cash pipeline view, KPIs, overdue callout, recent activity.
- **Contacts** — customers and vendors.
- **Item Catalog** — reusable line items with default pricing.
- **Settings** — company info, default tax rate / terms, document numbering, JSON backup export,
  clear / load-sample data.

---

## Quick start

```bash
git clone <your-repo-url> ledger
cd ledger

# Option A — just open it
open ledger.html          # macOS  (Windows: start ledger.html)

# Option B — serve it (recommended; keeps localStorage on a stable origin)
npm run dev               # runs: npx serve .  → http://localhost:3000
```

No install required. On first load the app pulls React, Babel, and fonts from a CDN, then runs
offline after that.

---

## Project structure

```
ledger/
├─ ledger.html        # the entire app (UI, logic, styles) — this is what you edit
├─ CLAUDE.md          # deep project context for Claude Code (architecture, data model, invariants)
├─ README.md          # this file
├─ package.json       # dev script only; no runtime deps today
├─ .env.example       # placeholders for the planned Supabase backend
├─ .editorconfig
└─ .gitignore
```

The whole app lives in `ledger.html`. See **`CLAUDE.md`** for the data model, business-logic
invariants, design system, and the Supabase migration plan.

---

## How your data is stored

State is a single JSON object saved to `localStorage` under the key `ledger:v1`. That means:

- Data lives in **one browser on one machine** — it doesn't sync.
- **Back up regularly:** Settings → *Export Backup (JSON)*.
- To start clean: Settings → *Clear All Data*; to explore: *Load Sample Data*.

Removing the single-browser limitation (Supabase backend + sync + auth) is the top roadmap item.

---

## Roadmap (short)

1. Supabase backend + sync, then auth / multi-user
2. Reporting — P&L, sales tax collected, A/R & A/P summaries
3. Standalone invoices & partial invoicing of a sales order
4. Credit notes / refunds, recurring invoices
5. Optional build tooling (Vite) if the single file outgrows itself

Full detail, including the schema and migration seam, is in `CLAUDE.md`.

---

## Working on it

Edit `ledger.html`, save, refresh. A few house rules that keep the app coherent (all spelled out in
`CLAUDE.md`): route every state change through `setDb(...)`, format money/dates only via the helpers,
and preserve the quote → SO → invoice chain and derived-status logic.

---

## License

Private project — add a license here if/when you decide to share it.
