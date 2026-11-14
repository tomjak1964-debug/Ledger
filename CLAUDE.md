# Ledger — Quote-to-Cash Accounting App

Project context for Claude Code, kept to the standards' skeleton (S6.3). The long notes live in `docs/`:
**`docs/FEATURES.md`** (how each part works — read the entry before changing that area), **`docs/HISTORY.md`** (the
original single-file version and the pre-backend roadmap), **`docs/IMPROVEMENTS.md`** (the agreed work list) and
**`docs/STANDARDS.md`** (the app standards).

## What this is

TMJ Engineering's books: a small industrial-controls business runs the whole **quote → cash** cycle (proposals, quotes,
sales orders / jobs, invoices, receipts), payables, expenses, cards, the line of credit, bank reconciliation and a
cash-basis general ledger in it. **Ledger is the book of record** (Sage was cancelled 2026-10-07). The app is **`app/`**
(Vite + React + supabase-js, PWA); `ledger.html` at the root is the original single-file version, kept for reference
only (`docs/HISTORY.md`).

## Backend: self-hosted on HomeServer (since 2026-10-03)

The database, logins, file storage and server functions no longer run on Supabase.com. They run in a
**self-hosted Supabase stack on Tom's home server (the NUC)**, managed from the HomeServer repo
(`tomjak1964-debug/HomeServer`: runbook `docs/03-ledger.md`, live checklist `docs/STATUS.md`).

- **Public API:** `https://api.tmjledger.com` through Cloudflare Tunnel; only the rest, auth, storage, functions paths get
  through. On the NUC the stack is `~/apps/ledger` (containers `ledger-*`, API at `http://127.0.0.1:8200`).
- **Website:** unchanged on Vercel. It finds the backend through Vercel env vars `VITE_SUPABASE_URL=https://api.tmjledger.com` and `VITE_SUPABASE_ANON_KEY` (the NUC's anon key), Production and Preview
  Pushing to `main` still deploys the site as before.
- **Supabase.com project `iusqcwfgciavixuhywoh` is retired.** It's kept untouched as a fallback for a few weeks, then
  deleted. Never apply changes there, and don't use its dashboard or SQL editor. Older docs in this repo that
  say "run it in the Supabase SQL editor" now mean "apply it on the NUC" (below).

**Database changes (schema, functions, policies, data fixes)** — only from a Claude session on the NUC (the
`ledger` remote-control environment, folder `~/src/ledger`); cloud sessions can change code but can't
reach the database, by design.
1. Write the SQL as a file in app/supabase/migrations/ (numbered files), as before, and commit it with the code that needs it.
2. Safety copy first:
   `docker exec ledger-db pg_dump -U supabase_admin -d postgres -Fc > ~/homeserver/backups/manual/ledger-$(date +%F-%H%M).dump`
   (restore: `docker exec -i ledger-db pg_restore -U supabase_admin -d postgres --clean --if-exists -n public < <file>`).
3. Apply it in one transaction:
   `docker exec -i ledger-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 --single-transaction < <file>.sql`
4. Let the API see it: `docker exec ledger-db psql -U postgres -c "notify pgrst, 'reload schema'"`.
5. Check it, then ship the code that uses it (push to `main`). Order matters when old code would break on the
   new schema or the other way round: apply first if the change is additive.

- **Edge functions** run in the stack's `functions` container. To ship a changed or new function:
  `cp -r app/supabase/functions/<name> ~/apps/ledger/volumes/functions/` then
  `cd ~/apps/ledger && docker compose restart functions`. Check with `docker compose logs --since 10m functions`.
  The Supabase dashboard paste is retired. Key checks are on (`FUNCTIONS_VERIFY_JWT=true`), and each function must
  still check the caller itself (a signed-in member), like `send-document` and `admin-create-user` do.
- **Email senders are chosen by document type, in `send-document`** (`FROM_BY_TYPE`): the app sends only a
  `docType` (`invoice` — invoices, credit memos, reminders; `remittance`; `proposal`; `ratesheet`), never an
  address, and the function maps it to `EMAIL_FROM_INVOICE` (invoices@tmjengineering.com) /
  `EMAIL_FROM_REMITTANCE` (remittances@) / `EMAIL_FROM_SALES` (sales@ — proposals and the rate sheet) /
  `EMAIL_FROM_RECEIVABLES` (receivables@ — the banking sheet, `docType: "banking"`). A `fromMe` flag ("Send as me", on the
  banking sheet) sends from the caller's own **business email** — `org_members.send_as` (migration 038), set next to
  their name in Users & Access, e.g. jakuszanek@tmjengineering.com for the owner login — under their name with replies
  to it; it must be on the company sender's domain (the only one Resend sends from), else the company address under
  their name with replies to their sign-in email. All three are
  aliases in the TMJ Engineering mailbox at Turbify, so replies arrive. An unknown type is refused; no type, or a per-type setting not set yet, uses
  `EMAIL_FROM`. Every `<EmailModal>` passes its `docType`.
  **CC the company's other contacts:** every email dialog addressed to a customer or vendor (invoices, reminders,
proposals, reports filtered to a customer, remittances) lists the company's other contacts with an email — and its own
company / remittance email — as *Also copy (CC)* ticks (`ccChoices(db, ids)` in `lib/people.js`, `EmailModal`'s
`ccChoices`); To still opens on the preferred person, whoever is in To isn't offered, and ticking writes the address into
CC. **Several recipients and CC:** the dialog's To and CC each take any number of addresses separated by commas
  (semicolons or spaces work too); `parseAddresses()` names any that aren't addresses and Send waits until they're
  fixed. The function takes `to` / `cc` as a list or a string (an older copy sends one string), re-checks every
  address, drops duplicates (and a CC that's already a To) and caps an email at 20 recipients.
- **Every email is logged** (`email_log`, migration 040): `send-document` writes one row per attempt — when, who
  sent it (and as which address), to / cc, `docType`, subject, attachment file names, the message text and
  `sent` / `failed` with the error — after Resend answers; a logging failure never fails the email. Members can
  read it with the `reports` permission; nothing but the function writes it. Reports → **Company → Correspondence**
  lists it (date range, search by recipient / subject / file, Summary or Detail with the message text, CSV, PDF).
  Only emails sent since 2026-10-26 are there.
- **Function secrets** (`RESEND_API_KEY`, `EMAIL_FROM`=`remittances@tmjengineering.com`, `EMAIL_FROM_INVOICE`,
  `EMAIL_FROM_REMITTANCE`, `EMAIL_FROM_SALES`, `EMAIL_FROM_RECEIVABLES`, `CRON_SECRET`) live in
  `~/apps/ledger/.env` on the NUC, never in git. A new secret also has to be listed under `functions:` in
  HomeServer's `apps/ledger/docker-compose.homeserver.yml`, then `docker compose up -d functions`.
- **Storage** (`attachments`, `backups` buckets) is on the NUC's disk (`~/apps/ledger/volumes/storage`); its access
  policies are in HomeServer's `apps/ledger/post-restore.sql`. A new bucket policy goes in both places.
- **Users & Access** shows each member by **name** (`org_members.name`, migration 032, editable there and set
  on Create User) with a **last signed in** pill — green within a week, grey older, amber never. The time comes
  from `member_sign_ins(org)`, a security-definer function that returns the auth sign-in times for that
  company's members to an admin of it, and nothing to anyone else.
- **Logins**: email + password, no public sign-up; admins create logins through `admin-create-user` and hand
  over the first password. Anyone can change their own from **Change password** at the foot of the menu
  (`components/ChangePassword.jsx`). **Forgot password?** on the sign-in page emails a reset link
  (`resetPasswordForEmail`, redirect to `/app`); following it raises `PASSWORD_RECOVERY` and `main.jsx` shows
  *Set a new password* before the app. The auth container sends it through Resend's SMTP
  (`SMTP_HOST=smtp.resend.com`, port 587, user `resend`, the Resend API key as password,
  from `remittances@tmjengineering.com` as "TMJ Ledger") and allows redirects back to
  `https://www.tmjledger.com/**` (`ADDITIONAL_REDIRECT_URLS`) — set in `~/apps/ledger/.env` on 2026-10-09.
- Scheduled JSON backups (`scheduled-backup`) aren't scheduled on the NUC: the NUC's nightly database dump covers
  every table. Supabase.com's two cron jobs never worked.
- **Backups:** every night at 03:10 the NUC dumps this database and its stored files into a bundle that is copied
  to the NAS at 03:20 (HomeServer `scripts/backup-local.sh`, `backup-to-nas.sh`).
- **Logs:** `cd ~/apps/ledger && docker compose logs --since 1h rest` (or `auth`, `functions`, `storage`)
- **The house depends on this box.** Don't restart other stacks, Home Assistant, Z-Wave or `cloudflared`, don't
  upgrade Docker, and don't change UFW from an app session; those belong to the HomeServer session. Secrets never
  go in git (they live in `~/apps/ledger/.env`).

## House rules

- **Ledger is the book of record.** Back up before any data change (`pg_dump`, above), guard data fixes so they touch
  exactly what they mean to (row counts checked, rolled back otherwise), check totals after, and keep the SQL in
  `app/supabase/data-fixes/`. Never put secrets or **account numbers** (bank, card, loan, customer) in git — last four
  digits at most. Bank details live only in the database (`bank_info`, RLS).
- **Merge to `main` only when Tom says so.** Work on the branch, push, ask; then push `HEAD:main` and check
  `https://www.tmjledger.com/version.json` shows the new rev.
- **Run `npm test` (in `app/`) before pushing** anything in `calc/` or `lib/`; add a test for each money bug fixed
  Fixtures are made up in the banks' layouts — never a real statement.
- **Bump `app/version.json`** (Rev X.yy) for every change the shop can see
- Every Print goes through `printOrShare()`, never `window.print()`; an inline editor carries `data-editing` so a
  self-update can't land under it; a printable overlay sits outside `.main`.
- Prefer building with stated assumptions over long clarifying rounds; say what you assumed

## Core business logic & invariants (§6)

These are the rules that make the app coherent. **Preserve them** unless a task explicitly changes them.

### The conversion chain (the heart of the app)
1. **Quote → Sales Order** (`convertToSO` in `QuotesView`): prompts for the customer PO#, creates
   a `salesOrder` with `status:"open"`, deep-copies line items (fresh `uid`s), and stamps the
   quote with `status:"accepted"` + `salesOrderId`. This is the "PO received" trigger.
2. **Sales Order → Invoice** (`generateInvoice` in `SalesOrdersView`): creates an `invoice`,
   `dueDate = today + settings.terms`, copies line items, sets SO `status:"invoiced"` + `invoiceId`.
3. **Invoice → paid**: `PaymentModal` pushes into `invoice.payments[]`. Status recomputes.

Line items always **copy forward** (with new ids) — never share references across documents.

### Numbering
`nextNumber = prefix + "-" + String(counters[type]).padStart(4,"0")`. On save of a **new**
document, increment the matching `settings.counters` field. `startNew` reads the current counter,
so counters must be updated inside the same `setDb` call that adds the doc.

### Derived status (never stored for invoices/bills)
- `invoiceStatus(inv)`: `paid` if `settled(inv) >= total`; else `overdue` if `dueDate < today` and
  not fully settled; else `partial` if anything settled; else `unpaid`.
- `billStatus(bill)`: same logic against `bill.amount`
- Comparisons use small epsilons (`- 0.005`) to dodge float error. Keep that

### Cash vs. settled (discounts)
- `paid(doc)` is **cash** — what moved through the bank. Every cash figure (P&L, the registers,
  collected-to-date, the Sage reconciliation) reads it, so it must never absorb a discount.
- `discounts(doc)` sums `payments[].discount` — an early-payment term taken on a vendor bill, or
  one a customer took on an invoice. Migration 018; the shared `payments` table covers both sides.
- `settled(doc) = paid + discounts` is what **closes** a document: $980 cash plus a $20 discount
  settles a $1,000 bill.
- `balance(inv)` and `billBalance(bill)` both subtract `settled`. Use `billBalance` — the bill
  balance used to be hand-rolled at ten call sites, which is exactly how a discount gets missed
  in one of them.

### Money helpers
- `lineTotals(items, taxRate)` → `{ sub, tax, total }`. `sub = Σ qty*unitPrice`, `tax = sub*rate/100`
- `paid(doc)` = Σ `payments[].amount`
- `balance(doc)` = `round2(total - paid)`
- `round2(n)` for any stored/compared monetary result

### A/R and A/P aging
`agingBuckets(items, dueOf, balOf)` → `{ cur, d30, d60, d90, d90p }`, bucketed by
`daysBetween(dueDate, today)`: ≤0 current, 1–30, 31–60, 61–90, 90+. Only positive balances count.

### Dashboard pipeline (the signature UI)
Four stages — Quotes out (draft/sent), Sales Orders (open), Awaiting Payment (unpaid/partial/
overdue), Collected 30d — each showing count + summed value. In `app/` every stage and every KPI card is a link
to the page behind it (Open Receivables / Collected → Receivables, Payables Due → Payables, Expenses → Expenses,
the stages → Quotes / Sales Orders / Invoices / Receivables) — `Stat`'s `onClick`, styled `.linked`. Don't reduce this to generic stat cards;
the pipeline is the app's identity. **Cash Forecast** (below the pipeline, for anyone who reads both
Receivables and Payables — `components/CashForecast.jsx`, `calc/forecast.js`): checking's book balance today, then eight
weeks of money in (open invoices on their due dates) and out (open bills on theirs, overdue ones this week; each card's
latest statement ~25 days after it closed, the line of credit's last regular payment monthly, payroll at the six-month
average — those three marked estimates), the running balance and the **low point**. Overdue invoices are left out unless
*Count overdue invoices as paid this week* is ticked — counting them makes the outlook rosier than the books can promise.
A week opens to its items.

---

## Design system & conventions (§7)

Keep new UI consistent with the existing "engineering instrument" look. Derive colors/spacing from
the CSS custom properties in `:root` — don't hardcode hexes.

**Palette (CSS vars):** `--ink` #13233B (structure/navy), `--canvas` #EDF0F4, `--surface` #fff,
`--accent` #1F6FEB (interactive), semantics `--pos` (paid/in), `--warn` (pending/open),
`--neg` (overdue/out). Each has a `-wash` tint for backgrounds.

**Type:** `Space Grotesk` = display/headings, `Inter` = body/UI, `IBM Plex Mono` = all numbers, IDs,
money (use the `.mono` class; it sets tabular figures). Money and doc numbers are **always** mono.

**Status → color** (`Badge` component, don't invent new colors):
draft=gray, sent/open/partial=blue, accepted/paid/invoiced/fulfilled=green, unpaid=amber,
declined/overdue=red.

**Conventions**
- Format money only via `money()`, dates only via `fmtDate()`. Never hand-format
- New list module = a `card` with a `table`; empty state uses `<Empty>`; row actions are
  `btn ghost icon` buttons on the right. Editors are either an inline editor (like `QuoteEditor`)
  or a `<Modal>` (like bills/expenses/contacts).
- **Every list sorts on every column heading.** Build the table with `useTableSort` +
  `<SortTh>` (`src/components/ui.jsx`): one accessor per column, `num` on money and counts,
  and map the rows the hook returns rather than the raw array. This is not optional on a new
  list page — a column a user can see is a column they can sort by. Only three kinds of table
  are exempt: line-item **editors** (order is the document's own), the **dashboard** (ordered
  by what it is reporting), and a **customer statement** (a running balance is chronological by
  definition). Where the view exports CSV, export the sorted rows so the file matches the
  screen. Hooks go above any early `return`, and a hook can't live inside a conditional block —
  hoist the rows it sorts (see `TimeTracking.jsx`).
- Every mutation goes through `setDb(d => ...)`. Show a `toast("…")` on success
- Copy style: active voice, sentence case, name things by what the user does. Buttons say exactly
  what happens ("Generate Invoice", "Record Payment").
- Accessibility floor already in place (focus-visible, reduced-motion, mobile sidebar) — keep it

---

## Features

What's built, one line each; the detail of every entry is in **`docs/FEATURES.md`** under the same title.

- Issuing a credit note
- Applying a credit
- No cash moves
- Invoicing several jobs at once
- `dbRef.current` is the state, not a copy of it
- Importing a quote chart
- Every document has the same toolbar
- A printable document overlay belongs outside `.main`
- Two kinds of proposal
- System Rates
- Fixture proposal prices can be overridden
- Milestones billed on receipt of the PO raise their invoice task
- Several proposals on one PO
- Emailing a proposal submits it
- Copy Proposal
- Rates have one home: Settings → Time Categories
- Rate sheet
- Banking information sheet
- Estimating from a lineup
- Contacts and who gets what
- Prefix and numbering
- Aged Receivables / Aged Payables
- Payment terms live on the contact
- Early-payment discounts are offered, never taken automatically
- Line-item descriptions are multi-line
- Invoices print as full pages
- Public landing page
- The mark: "Double Entry"
- Revision and updates
- Reports print as real documents
- Reports open on Year to Date
- Invoice emails can carry the customer's Aged Receivables
- Printing on an iPad / iPhone
- Unsticking a cached copy
- Print forms
- The bill editor always works in lines
- Partial payments
- Discounts taken
- Emailing a remittance
- Pay Bills references
- Copy an invoice or bill (Rev 1.87, standards S2.10 — Ledger is the reference)
- The actions are on the list row too
- Select several at once
- The menu folds away
- Navigation groups
- Fixture proposal scope packages
- Fixture Rates
- The phone menu closes on a tap outside it
- The page area scrolls on its own
- General ledger
- The books are kept on a cash basis
- Year-end close and the balance sheet
- Locking the books
- Month-End Close
- Year-End
- Journal entries by hand
- Bank reconciliation
- Company credit cards
- Tests
- Network failures on a save
- Remittance PDFs are named
- Invoices: Sent, not printed (since Rev 1.69)
- Marking an invoice printed by hand
- Show/hide settled documents
- Tooling
- The Jobs page counts lines, not percentages
- Jobs: tracking and costing
- Service reports
- Sales order numbers
- Team activity becomes tasks
- List tables don't reflow
- The top-bar search opens the record
- Exports are Excel
- One document toolbar everywhere
- Recurring invoices and bills
- Sortable lists
- Not built (candidates for next work)

**Not built yet:** refunds (returning cash rather than crediting) · partial invoicing of an SO · attachments / receipt
photos · quote line-item reordering · a live bank feed (statements are imported by file; see the PNC API note in
`docs/IMPROVEMENTS.md`) · undo · Capacitor store apps.

## Lists, Excel and reports

Every list sorts on every column (`useTableSort` + `SortTh`), filters by date range and party (`useFilters`), and
exports what's on screen as Excel (`downloadCSV` → `lib/excel.js`). Reports print as real documents
(`lib/reportPdf.js`): letterhead and headings on every page, "Page n of m", Email / Save PDF / Print from the report's
toolbar. Details: `docs/FEATURES.md` (Reports, Aged Receivables / Aged Payables, Exports are Excel).

## Working style

- Preserve the invariants in §6 and the design conventions in §7 unless a task changes them on purpose
- All state changes through the store's actions (`lib/store.js`); all money/date formatting through the helpers
- When adding a module, mirror an existing one (list `card` + `table` + `Empty` + modal/inline editor)
- Prefer building with stated assumptions over long clarifying rounds; call out assumptions in your summary
- Sketch the plan before a change that spans many files

---

## Standards

This app follows the HomeServer app development standards, `docs/STANDARDS.md` (v1.0, 2026-11-05; synced from
HomeServer `templates/app/STANDARDS.md` by `scripts/sync-standards.sh` — don't edit the copy here, propose changes
to Tom). Before building or changing a menu, page header, document/report, list, form, button, dialog, toast,
upload, phone/email display, permission or Excel feature, read the matching section and use its reference code.
Every PR says "Standards: followed" or names the exception.
**Exceptions agreed for this app:** none.
**Known gaps (adopted when that area is next touched):** portal `DocumentView`; open rows on tap; `fetchAll` for growable tables; audit_log policy; call links; distinct menu icons; load IBM Plex Mono.


## Database changes applied

Every migration in `app/supabase/migrations/` has been applied on the NUC (steps under Backend): 002_invoice_notes · 003_shared_org_and_proposals · 004_contact_code · 005_payment_ref · 006_partial_invoicing_and_audit · 007_roles_and_permissions · 008_jobs_and_time · 009_job_costing · 010_attachments · 011_purchase_orders · 012_time_approval · 013_backups · 014_field_module · 015_close_lines_and_print_flag · 016_proposal_contact_name · 017_remittance_contact · 018_payment_discount · 019_contact_terms · 020_credit_notes · 021_controls_estimates · 022_vendor_tax_id · 023_fixture_rate_columns · 024_general_ledger · 025_journal_entries · 026_journal_entries_balanced · 027_bank_reconciliation · 028_job_tracking · 029_service_reports · 030_period_lock · 031_card_statements · 032_member_names_sign_ins · 033_contact_active · 034_preferred_contacts · 035_fixture_hmi_hardware_design · 036_contact_prefix · 037_bank_info · 038_member_send_as · 039_doc_number_suffix · 040_email_log · 041_bill_lines · 042_loan_statements · 043_recurring.
Data fixes are in `app/supabase/data-fixes/`, each named by date.

## Still to come

The agreed list is **`docs/IMPROVEMENTS.md`** — work it in order and tick items as they go live.
