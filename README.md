# Ledger — Quote-to-Cash

An accounting app for a small industrial-controls shop: run the full
**quote → sales order → invoice → payment** cycle, plus payables and expenses.

There are two versions in this repo (same layout as the golf-league project):

- **`app/`** — the active **multi-device** rebuild (Vite + React + **Supabase**).
  Sign in from any computer or phone and see the same live books. This is what
  you deploy.
- **`ledger.html`** — the original **single-file** app (React via in-browser
  Babel, data in `localStorage`). Kept as the reference/legacy version and
  offline fallback; no build step — just open it in a browser.

## The rebuild (`app/`)

A static React SPA backed by Supabase (Postgres + auth). The browser talks to
Supabase directly over HTTPS; there's no custom server to run.

- **Auth:** email + password (Supabase Auth). Every table is protected by
  Row-Level Security scoped to your user id.
- **Same app, same look:** all views, the printable quote/invoice documents,
  the pipeline dashboard, and the business logic (conversion chain, derived
  statuses, aging) are ported verbatim from the single-file version.
- **Safe document numbers:** quote/SO/invoice/bill numbers are claimed through
  a Postgres function, so two devices can never mint the same number.
- **Bring your data:** Settings → Import Backup (JSON) accepts the backup file
  exported from `ledger.html` and migrates everything — contacts, catalog, the
  full quote→SO→invoice chain, payments, bills, expenses, and counters.

### Run locally

```bash
cd app
npm install
npm run dev
```

Create `app/.env.local` from `app/.env.example` with your Supabase URL + anon
key. Backend setup (one SQL file + a few dashboard clicks) is in
[`app/supabase/README.md`](app/supabase/README.md).

### Deploy

Static build (`npm --prefix app run build` → `app/dist`). Configs for
**Netlify** (`netlify.toml`) and **Vercel** (`vercel.json`) are at the repo
root — connect the repo, set the two `VITE_SUPABASE_*` environment variables,
and deploy.

## The legacy single-file version

Open `ledger.html` in a browser (or `npm run dev` at the repo root to serve
it). Data stays in that browser's `localStorage`; use Settings → Export Backup
to move it into the new app.

## Project notes

The data model, business-logic invariants, design system, and the migration
plan live in [`CLAUDE.md`](CLAUDE.md).

## License

Private project — add a license here if/when you decide to share it.
