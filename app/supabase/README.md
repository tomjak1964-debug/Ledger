# Supabase backend setup

One-time setup for the Ledger backend. Takes about 10 minutes. (Same flow as
the golf-league project, minus the seed scripts.)

## 1. Create the project

1. Go to <https://supabase.com>, sign in (GitHub login is fine), and click
   **New project**.
2. Pick any name (e.g. `ledger`), a strong database password (save it, though
   the app never uses it), and the region closest to you (US East/Central).
3. Wait ~1 minute for provisioning.

## 2. Run the schema

1. In the Supabase dashboard: **SQL Editor → New query**.
2. Paste the entire contents of [`schema.sql`](schema.sql) and click **Run**.
3. You should see "Success. No rows returned". Re-running it later is safe —
   everything is `if not exists` / `drop policy if exists`.

## 3. Configure auth

1. **Authentication → Sign In / Up → Email**: make sure the Email provider is
   enabled (it is by default).
2. Recommended for a personal tool: turn **Confirm email** OFF
   (Authentication → Sign In / Up → Email → "Confirm email") so creating your
   account signs you straight in. Leave it on if you prefer the confirmation
   step — the app handles both.

## 4. Point the app at your project

1. In the dashboard: **Project Settings → API Keys**. Copy the **Project URL**
   and the **anon / public** key (never the service-role key).
2. In `app/`, copy `.env.example` to `.env.local` and paste both values:

   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```

3. `npm install && npm run dev` in `app/`, open http://localhost:5173, and
   create your account (email + password) on the sign-in screen.

## 5. Bring your data over

In the old single-file app (`ledger.html`): **Settings → Export Backup
(JSON)**. In the new app: **Settings → Import Backup (JSON)** and pick that
file. Everything comes across — contacts, catalog, quotes, sales orders,
invoices, payments, bills, expenses, company settings, and document counters.

## Migrations

If you ran `schema.sql` before a migration existed, run the files in
[`migrations/`](migrations/) (in number order) in the SQL editor. Currently:

- `002_invoice_notes.sql` — adds the per-invoice `notes` column (needed for
  invoice editing / standalone invoices). Fresh installs of `schema.sql`
  already include it.

## Notes

- **RLS everywhere:** every table is scoped to `auth.uid()`. The anon key in
  the browser can only ever read/write the signed-in user's rows.
- **Document numbers** are claimed through the `next_doc_number()` Postgres
  function, so two devices can't mint the same invoice number. If a save fails
  after a number was claimed, that number is simply skipped — gaps are normal.
- **Backups:** Settings → Export Backup (JSON) still works in the new app and
  produces the same shape as the legacy version. Supabase also does daily
  database backups on all plans.
