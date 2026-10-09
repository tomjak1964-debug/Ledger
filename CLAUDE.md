# Ledger — Quote-to-Cash Accounting App

Project context for Claude Code. Keep this file (`CLAUDE.md`) next to `ledger.html` at the repo
root so it's read automatically as session context.

---

## Backend: self-hosted on HomeServer (since 2026-10-03)

The database, logins, file storage and server functions no longer run on Supabase.com. They run in a
**self-hosted Supabase stack on Tom's home server (the NUC)**, managed from the HomeServer repo
(`tomjak1964-debug/HomeServer`: runbook `docs/03-ledger.md`, live checklist `docs/STATUS.md`).

- **Public API:** `https://api.tmjledger.com` through Cloudflare Tunnel; only the rest, auth, storage, functions paths get
  through. On the NUC the stack is `~/apps/ledger` (containers `ledger-*`, API at `http://127.0.0.1:8200`).
- **Website:** unchanged on Vercel. It finds the backend through Vercel env vars `VITE_SUPABASE_URL=https://api.tmjledger.com` and `VITE_SUPABASE_ANON_KEY` (the NUC's anon key), Production and Preview.
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
- **Function secrets** (`RESEND_API_KEY`, `EMAIL_FROM`=`remittances@tmjengineering.com`, `CRON_SECRET`) live in
  `~/apps/ledger/.env` on the NUC, never in git. A new secret also has to be listed under `functions:` in
  HomeServer's `apps/ledger/docker-compose.homeserver.yml`, then `docker compose up -d functions`.
- **Storage** (`attachments`, `backups` buckets) is on the NUC's disk (`~/apps/ledger/volumes/storage`); its access
  policies are in HomeServer's `apps/ledger/post-restore.sql`. A new bucket policy goes in both places.
- **Logins**: email + password, no public sign-up; admins create logins through `admin-create-user`.
- Scheduled JSON backups (`scheduled-backup`) aren't scheduled on the NUC: the NUC's nightly database dump covers
  every table. Supabase.com's two cron jobs never worked.
- **Backups:** every night at 03:10 the NUC dumps this database and its stored files into a bundle that is copied
  to the NAS at 03:20 (HomeServer `scripts/backup-local.sh`, `backup-to-nas.sh`).
- **Logs:** `cd ~/apps/ledger && docker compose logs --since 1h rest` (or `auth`, `functions`, `storage`).
- **The house depends on this box.** Don't restart other stacks, Home Assistant, Z-Wave or `cloudflared`, don't
  upgrade Docker, and don't change UFW from an app session; those belong to the HomeServer session. Secrets never
  go in git (they live in `~/apps/ledger/.env`).

## 1. What this is

A single-file browser app for a small industrial-controls business to run the full
**quote → cash** cycle plus payables and expenses. No build step, no server — one HTML file
you open in a browser. State persists to `localStorage`.

**Current status:** working v1, plus the Supabase rebuild from §11 now exists in **`app/`**
(Vite + React + supabase-js; schema in `app/supabase/schema.sql`). The rebuild ports the calc
core, views, and CSS verbatim; state flows through `app/src/lib/store.js` (write-through actions)
instead of `setDb`. `ledger.html` stays as the reference/legacy version until parity is confirmed.

For new feature work, prefer `app/`. The invariants (§6) and design system (§7) apply to both
versions. When editing `ledger.html`, work directly in that file.

---

## 2. Run / dev loop

- **Run:** double-click `ledger.html`, or serve it (`python -m http.server` / `npx serve`) and
  open in a browser. Serving is preferable so `localStorage` is scoped to a stable origin.
- **No build.** JSX is transpiled in-browser by Babel Standalone (see §3). Edit → save → refresh.
- **Reset data:** Settings → *Clear All Data* (empty) or *Load Sample Data* (seed set).
  Or clear the `ledger:v1` key in DevTools → Application → Local Storage.
- **Backup:** Settings → *Export Backup (JSON)* dumps the entire state object.

**Gotcha:** first load needs internet to pull React + Babel + Google Fonts from CDNs. Once
cached it runs offline. If you want true offline / faster load, vendor those locally or move to a
bundler (§10, "Build tooling").

---

## 3. Architecture & tech decisions

| Concern | Choice | Why |
|---|---|---|
| Delivery | Single `.html` file | Matches existing workflow; zero-setup; easy to hand around |
| UI | React 18 (UMD) + Babel Standalone, `type="text/babel"` | No toolchain; edit-and-refresh |
| State | One plain object in `useState`, top of `App` | Simple; whole DB is one JSON blob |
| Persistence | `localStorage` key `ledger:v1`, with in-memory fallback | No server; degrades gracefully if storage blocked |
| Styling | Hand-written CSS in `<style>`, CSS custom properties | Full control over the "instrument panel" look; no Tailwind CDN dependency |
| Money math | Plain JS, `round2()` to 2 dp | Fine for this scale; watch float edges on comparisons (uses epsilons) |

**Persistence layer (the seam to replace for a backend):**
- `STORE_KEY = "ledger:v1"`
- `loadState()` — reads/parses localStorage, returns `null` on miss or error
- `saveState(s)` — writes, swallows errors (private mode / quota)
- `setDb(updater)` in `App` — the **only** way state changes. Wraps `setState`, computes the
  next state, calls `saveState(next)`, returns it. Every module gets `setDb` and calls it with a
  function `d => ({...d, ...})`. **Route all mutations through `setDb`** so persistence stays automatic.

---

## 4. File map (`ledger.html`)

Single file, ordered top-to-bottom inside the `<script type="text/babel">` block:

1. **Persistence** — `loadState`, `saveState`, `STORE_KEY`.
2. **Helpers** — `uid`, `todayISO`, `addDays`, `daysBetween`, `money`, `fmtDate`, `cls`, `sum`,
   `round2`, `lineTotals`, `paid`, `balance`, `invoiceStatus`, `billStatus`.
3. **Seed** — `seed()` returns the initial DB; `EXPENSE_CATS` array.
4. **UI primitives** — `Ico`/`ICONS`, `Badge`, `Stat`, `Empty`, `Modal`, `Field`,
   `LineItemsEditor`, `DocumentView` (printable quote/invoice).
5. **Feature views** — `Dashboard`, `QuotesView` (+ `QuoteMenu`, `MenuItem`, `QuoteEditor`),
   `SalesOrdersView`, `InvoicesView` (+ `PaymentModal`), `ReceivablesView`, `PayablesView`,
   `ExpensesView`, `ContactsView`, `CatalogView`, `SettingsView`. `nameOf()` and `agingBuckets()`
   are near the views that use them.
6. **Shell** — `NAV`, `TITLES`, `App`, then `ReactDOM.createRoot(...).render(<App/>)`.

CSS lives in one `<style>` in `<head>`, organized by comment banners: shell, primitives,
line-item editor, modal, pipeline (the dashboard signature), aging, printable document, responsive.

---

## 5. Data model

Everything is one object persisted at `localStorage["ledger:v1"]`. Shape:

```
{
  settings, contacts[], catalog[], quotes[], salesOrders[], invoices[], bills[], expenses[]
}
```

IDs are random strings from `uid()`. Dates are ISO `YYYY-MM-DD` strings. Money is a JS number.

### settings
```
{
  company, companyAddress, companyEmail, companyPhone,   // printed on documents
  taxRate,          // number, default % applied to new quotes
  terms,            // number of days; sets invoice/bill due dates
  quotePrefix, soPrefix, invPrefix, billPrefix,          // e.g. "QUO"
  counters: { quote, so, invoice, bill },                // next sequence number per type
  quoteNotes, invoiceNotes                               // default footer text on printed docs
}
```

### contacts[] — customers and vendors share one array
```
{ id, type: "customer" | "vendor", name, contact, email, phone, address }
```
`address` is a multiline string (`\n` separated). Filter by `type` per view.

### catalog[] — reusable quote line items
```
{ id, desc, unit, unitPrice }
```

### quotes[]
```
{
  id, number,                         // "QUO-0001"
  customerId,                         // -> contacts[].id
  date, expiryDate,
  status: "draft" | "sent" | "accepted" | "declined",   // stored, user-set
  poNumber,                           // filled at conversion
  lineItems: [ { id, desc, qty, unit, unitPrice } ],
  taxRate,                            // % snapshot at creation
  notes,
  salesOrderId?                       // set once converted
}
```
Transient field `_new: true` exists only while creating; it's deleted before save and drives the
counter increment. Don't persist it.

### salesOrders[]
```
{
  id, number,                         // "SO-0001"
  quoteId, customerId, poNumber,
  date,
  status: "open" | "invoiced",        // stored
  lineItems: [ ... ],                 // copied from quote at conversion
  taxRate,
  invoiceId?                          // set once invoiced
}
```

### invoices[]
```
{
  id, number,                         // "INV-0001"
  salesOrderId, quoteId, customerId, poNumber,
  date, dueDate,
  lineItems: [ ... ],
  taxRate,
  payments: [ { id, amount, date, method } ]
}
```
**Invoice status is NOT stored** — it's derived by `invoiceStatus(inv)` (§6).

### bills[] — accounts payable
```
{
  id, number,                         // "BILL-0001"
  vendorId, date, dueDate,
  amount,                             // single number (not line items)
  ref,                                // vendor's invoice #
  notes,
  payments: [ { id, amount, date, method } ]
}
```
Status derived by `billStatus(bill)`.

### expenses[]
```
{ id, date, category, vendor, amount, method, notes }
```
`category` is one of `EXPENSE_CATS`.

---

## 6. Core business logic & invariants

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
- `billStatus(bill)`: same logic against `bill.amount`.
- Comparisons use small epsilons (`- 0.005`) to dodge float error. Keep that.

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
- `lineTotals(items, taxRate)` → `{ sub, tax, total }`. `sub = Σ qty*unitPrice`, `tax = sub*rate/100`.
- `paid(doc)` = Σ `payments[].amount`.
- `balance(doc)` = `round2(total - paid)`.
- `round2(n)` for any stored/compared monetary result.

### A/R and A/P aging
`agingBuckets(items, dueOf, balOf)` → `{ cur, d30, d60, d90, d90p }`, bucketed by
`daysBetween(dueDate, today)`: ≤0 current, 1–30, 31–60, 61–90, 90+. Only positive balances count.

### Dashboard pipeline (the signature UI)
Four stages — Quotes out (draft/sent), Sales Orders (open), Awaiting Payment (unpaid/partial/
overdue), Collected 30d — each showing count + summed value. Don't reduce this to generic stat cards;
the pipeline is the app's identity.

---

## 7. Design system & conventions

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
- Format money only via `money()`, dates only via `fmtDate()`. Never hand-format.
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
- Every mutation goes through `setDb(d => ...)`. Show a `toast("…")` on success.
- Copy style: active voice, sentence case, name things by what the user does. Buttons say exactly
  what happens ("Generate Invoice", "Record Payment").
- Accessibility floor already in place (focus-visible, reduced-motion, mobile sidebar) — keep it.

---

## 8. Built / not built

**Built:** Dashboard (KPIs, pipeline, overdue callout, recent activity) · Quotes (dynamic
line-item form, catalog insert, statuses, search, printable) · Quote→SO conversion with PO ·
Sales Orders · SO→Invoice generation · Invoices (payments, printable) · Receivables (A/R aging) ·
Payables (vendor bills, A/P aging, payments) · Expenses (by category) · Customers and Vendors (one page each) ·
Item Catalog · Settings (company, defaults, numbering, JSON export, clear/seed) · print/PDF for
quotes and invoices.

**Built in `app/` only (beyond the legacy feature set):** Supabase backend + auth + multi-device ·
atomic document numbering · JSON backup import · **Reports** (cash-basis P&L, sales tax
invoiced/collected, sales by customer, expenses by category, printable customer statements, CSV
export, date-range presets — `src/calc/reports.js` + `src/views/Reports.jsx`) organised into
**Sage-style report categories** (a category rail; empty categories stay visible so reports can
slot in later) with **Receipts / Payments registers** in summary or detail form · a shared
**date-range + customer/vendor filter** (`src/lib/dateRanges.js`, `src/components/FilterBar.jsx`,
`useFilters()`) on every report and every sortable list view · **extra ad-hoc lines** when
invoicing from a sales order (billed on that invoice only; the SO keeps its PO and its lines) · **standalone +
editable invoices** with per-invoice notes (`invoices.notes`, migration 002) · payment
delete/correction · **check register** (`src/lib/checks.js` — next check number remembered and
overridable, duplicate numbers refused, voiding a check reopens its bills and frees the number) ·
**guided payment flow** (record → print → confirm the check printed → email/save → every dialog
closes; a misprinted check is reversed in one click) · **payments & receipts register**
(`src/components/PaymentRegister.jsx`, shown as Vendors & Purchases → Payments and Receivables → Receipts:
search, date range, edit, delete, void a whole check, print a check again from its row; on the payments side each bill line also shows the vendor's invoice number (`bill.ref`), and the search finds it; both sides list one row per
check/transfer, expandable to the invoices or bills it covered — `receiptGroups()` in
`src/calc/reports.js` does the grouping) · **whole receipts and payments are editable**
(`src/components/PaymentGroupModal.jsx` + `updatePaymentGroup()` in `store.js`: open a
receipt or check, add documents to it, untick to take them off, correct the applied
amounts; nothing is ticked by default and Select all / Deselect all sit above the list —
the same modal records a receipt) · **a payment can be moved to another
document** (the "Applied to" selector in the single-line editor, `updatePayment`'s
`toParentId`) — money landed on the wrong bill or invoice is re-pointed keeping its
date, method and reference, and both documents re-settle themselves · vendor **remittance contact** (A/P name /
number / email / remit-to address, migration 017 — the email default when sending a remittance,
and the mail-to block on printed checks and remittances) · installable PWA (manifest + icons +
service worker; Supabase never cached).

**Issuing a credit note** (`src/components/CreditNoteModal.jsx`, migration 020): a credit note is an
A/R document of its own — **New Credit Note** in Receivables writes one, and the pencil on a credit row
edits it. Amounts are typed **positive** (what you are crediting) and stored negative, so the document
carries a negative total and lands in Receivables as an open credit; the due date is the credit date,
because a credit is not owed. Credit notes number from their own series — `settings.creditPrefix`
(default `CM`) plus `next_doc_number('credit')`, so they never consume an invoice number. What makes a
document a credit is now `invoices.kind` (`'invoice'` | `'credit'`, migration 020 — the migration
backfills existing negative invoices); `isCreditMemo()` still falls back to the negative-total rule for
anything typed before the column existed. Editing refuses to cut a credit below what has already been
applied to invoices. Printed and PDF'd it reads **CREDIT MEMO** — positive amounts, "Credit Note #",
"Credit memo" in the terms box, and Total Credit / Applied to invoices / **CREDIT REMAINING**.

**Applying a credit** (`src/lib/credits.js`, `src/components/ApplyCreditModal.jsx`, `applyCredit()` in
`store.js`): a credit note carries a negative total, so it already sits in Receivables with a
negative balance. **Apply Credit** — on the credit's own row, or on any open invoice for a customer who
has one — opens a dialog listing that customer's open invoices oldest first, with **Oldest first** to
spend the credit down the list in a click. Nothing is applied until an amount is typed, what is left
stays on the credit, and the dialog refuses to apply more than an invoice owes (the precise complaint)
or more than the credit holds.

**No cash moves.** Each allocation writes a *pair* of payment rows with method `Credit` and the credit's
number as the reference: **+amount on the invoice, −amount on the credit**. The invoice settles against
`settled()` and the credit is consumed by its own negative total, while `paid()` — which is cash (§6) —
nets to zero across the pair, so the registers and the cash-basis P&L are untouched. The pair shares a
date, method and reference, so the register groups it as one entry worth nothing, expandable to the two
documents; voiding that group unwinds both sides at once.

**Invoicing several jobs at once:** Tasks tick-selects the open *create invoice* tasks and bills them
two ways (`src/views/Tasks.jsx`). **Create N Invoices** shows what each job would bill — lines, approved
unbilled time (a tick turns time off for the whole run), and what the invoice comes to — then writes them
sequentially, so each claims its own number; a job the store refuses is reported and its task stays open
rather than stopping the run. **Review One by One** opens the normal `InvoiceFromSOModal` per job with a
`queue` prop: it shows *2 of 5*, Cancel reads **Skip**, and **Stop** ends the run. Either way the run ends
on a list of what was created with **Print** (straight to the print dialog — `openDoc(kind, doc, { autoPrint,
onPrinted })` opens the document, prints and closes it) and **Save** (downloads `INV-….pdf` from `invoicePdf()`
without the dialog, and marks the invoice printed) per invoice; each drops off the list once it's printed or
saved, so what's left is what still needs doing (*Show printed / saved* brings them back). The dialog closes itself after a
successful generate, so the queue advances in `onClose` and nowhere else — advancing in `onGenerate` too
skips a job.

**`dbRef.current` is the state, not a copy of it.** `setDb` applies the updater against the ref and
writes it before calling `setState`, because an action writes state and then reads it back in the same
tick — `reconcileJobTask()` right after `generateInvoice()`'s write, for one. Assigning the ref inside
the React updater left it an update behind (React runs the updater when it processes the update, not
when `setDb` is called), which a single action got away with and a batch did not: a run that billed
three jobs wrote all three invoices and left two of the three tasks open. Anything that loops over
documents — billing several jobs, applying credits, a pay run — depends on this. `reload()` also
reconciles job tasks **both ways** now, so a task stranded open by that bug closes itself on the next
load.

**Importing a quote chart** (`src/lib/quoteChart.js`, `src/components/ImportProposalsModal.jsx`): the
shop keeps one row per machine in a quote chart, and **Import Quote Chart** in Proposals turns that
chart into proposals — an `.xlsx` straight out of Excel, a `.csv`, or rows pasted from a sheet. The
`.xlsx` reader is the trick `tools/reconcile.mjs` uses (a zip of XML, inflated with
`DecompressionStream`), so there is no library to add. Columns are matched by heading, so column order
doesn't matter and the chart's working columns — the weighted point count and its division — are
ignored, because `ioBlocks()` recomputes them; the chart's I/O block figure only rides along as an
override when it disagrees with the formula. There is deliberately no bare `quote` heading in the
column map: a chart with both *QUOTE NUMBER* and an empty *QUOTE* column would otherwise blank the
number. The preview prices every row, pre-matches the machine type by name (*Sonuc* reads as *Sonic*),
and gives any row it can't match a dropdown — rates are never invented. Where the chart names a type
from the TMJ rate card that isn't set up yet, one button adds it: `seedMachineRates()` skips names
already present, so it both seeds an empty list and tops one up. Proposals are written one at a time so
each claims its own number; the chart's quote number and end user go in the notes. A row with no job number
takes the quote number as its job number, and with neither, the proposal date and a sequence for the day
(`dateJobNumber()` in `calc/proposals.js` — `261008-01`, `261008-02`…, following any already used).
**A new proposal starts on the customer the last proposal of its kind was for** (`defaultProposalCustomer(db,
kind)`: the newest fixture or system proposal's customer, so a system proposal for someone else leaves the
fixture default alone; else Venture Global Engineering), with that customer's contact; the quote-chart import
uses the same default. Changing the customer replaces the contact with the new customer's own, or blank.

**A printable document overlay belongs outside `.main`.** Printing hides the app behind the document
with `body.doc-open .main{display:none}` (`styles.css`), which needs both halves: the overlay adds
`doc-open` to the body, and it sits *outside* `.main` so that rule doesn't hide it too. `DocumentView`
is rendered by `App` as a sibling of `.main`; `ProposalDoc` lives inside `ProposalsView`, so it
portals itself to `document.body` (`createPortal`) and sets the same flag. Rendered in place it did
neither, and a printed proposal came out with the proposals list on the sheet ahead of it. The print
rules also drop `.app`'s `min-height:100vh` while a document is open: with its children hidden and the
document portalled outside it, that empty container printed as a blank first sheet. While a proposal is open, `document.title` is the file name — Print / Save PDF
suggests the tab title as the file name, so it matches the Word download; `proposalFileStem()` in
`src/lib/proposalDocx.js` is the one place that name is built. `DocumentView` does the same with the
document number, so an invoice, quote or PO prints as `INV-0042.pdf` — the name `invoicePdf()` already
gives the download.

**Two kinds of proposal** (`proposals.kind`, migration 021) — on screen a **Fixture Proposal** (`machine`) and a
**System Proposal** (`controls`); the code and the database keep the original kind names. `machine` is the Venture Global proposal
exactly as it was — content counts priced off Fixture Rates, the quote-chart import, the letter. `controls`
is the **Controls Estimate**: a job for any customer, built from the standard engineering components as
hours × rate (`src/calc/estimates.js` — `COMPONENTS`: Hardware Design, Drafting, PLC Program Development,
HMI Development, Start-Up/Debug, and optional Project Management, Documentation & Training, FAT, Safety
Validation), with hardware **optional** (a toggle; off, the document has no hardware section at all) and
the field work — trips × days × people — as Field Services with travel & living. An hour model suggests
hours from the job's content (I/O, drives, servo axes, stations, steps, screens, alarms, recipes, safety
system, vision, data collection); the estimator overrides any of them and the override prices. Standard
control elements (`STANDARD_ELEMENTS`) quick-add hardware lines with a description and a typical qty —
**never a price**. The editor, the document content and the on-screen body live in
`src/views/ControlsEstimate.jsx`; the Word export branches on `kind` in `proposalDocx.js`; `Proposals.jsx`
routes on `kind` everywhere else. The document carries the sections a general quote needs — header block
with number/rev/valid-through, Scope of Work per component with deliverables, Assumptions & Clarifications,
Exclusions, Pricing by group, Options priced separately, Schedule, Invoicing Schedule, Terms (payment
terms from the contact, validity, support rate) and an Acceptance block. **Everything it reads is in
Settings → Proposals** (`settings.proposal`, read through `proposalConfig()`): the letter fields that used
to be code-only defaults, the labor rate card, the hour model, the three invoicing splits (machine,
controls engineering-only, controls with hardware — toggling hardware swaps the split while it is still a
stock one), and the standard assumptions/exclusions. Hour and rate defaults are trade-standard starting
points, not the shop's own numbers. **Revisions:** New Revision writes the same number at `rev + 1` as a
fresh draft and marks the row it replaces `superseded` (a fifth status); the rev prints as *Rev A* on the
document and in the file name. A won proposal — either kind — lands on the sales order as **one line per
phase of its invoicing schedule** (`{job} {phase label}`, priced at the phase's share), however many phases it
has, so the job bills, marks ready and shows in Job Tracking milestone by milestone, like the Sage SOs. Each phase
keeps its line's id (`phases[].soLineId`), and billing works from either side: Invoice Phases on the proposal
flags the SO lines invoiced, and invoicing the SO marks the proposal's phases billed, so a milestone can't be
billed twice. A controls estimate with no schedule still lands as one line per group it priced
(Engineering / Hardware / Field Services / Contingency).

**Estimating from a lineup** (`src/lib/lineup.js`, `src/components/ImportLineupModal.jsx`): an integrator's
*Electrical Engineering Line-up* — one document per fixture with a header (job #, end user, fixture, PLC, HMI,
runoff), the sequence of operations, the components on the machine with `(xN)` quantities, the valve manifold
and sensors, and an I/O tally — is what a controls estimate is priced from. **Import Lineup** in Proposals
reads the PDFs (pdf.js, loaded on demand; text can be pasted instead) and `parseLineup()` turns each into the
counts the hour model reads: the header fields, the I/O totals, and one keyword rule per device
(`RULES`: cylinders, vacuum zones, sensors, operator stations, HMIs, VFDs, servo/electric actuators, robots,
torque controllers and P-sets, vision systems, dispensing systems, scanners, remote I/O blocks, networked
devices, E-stops, light curtains, other safety devices, analog/IO-Link points), plus stations, sequence steps
and part types. Devices are counted in the component lists only — the per-station tooling detail and the I/O
drawings that follow repeat them — and a sub-item (`o (x1) VS smart camera – Part #…`) is the item above it
in more detail, so it is skipped except under a valve or a torque tool. The parser is keyword-driven on
purpose: `(x31) Part present sensor` is 31 sensors whoever wrote the lineup, so another customer's format
parses too, and the review panel shows every count with the line it came from so the estimator corrects it
before anything is written. The customer is guessed from the name on the page; a start-up at a customer in
the same state as the shop is local, so travel & living is off unless the estimator turns it on.

The estimate's **Job Content** (`calc/estimates.js`) now has the lineup's vocabulary: `DEVICE_FIELDS` each carry
the discrete I/O they imply (`derivedIo()` — a clamp is two switches and two solenoids), so the I/O field can
be left blank and derived, and the hour model prices each device *beyond* its points (`perCylinder`,
`perRobot`, `perTorque`… in Settings → Proposals) with the points still priced per I/O. `reusePct` takes a
share off Hardware Design / Drafting / PLC / HMI when the lineup names a reference job; `travelIncluded:
false` drops Travel & Living. `specs.lineup` holds the header (`LINEUP_FIELDS`) and prints on the document
and in the Word export as **Basis of Estimate**, with `contentSummary()` ("197 discrete I/O · 23 pneumatic
cylinders · 1 robot…") under it, so the customer sees what the price was built on. Estimates saved before
this keep working: a missing device count is zero, a `vision: true` tick still prices as one vision system.

**Payment terms live on the contact** (`src/lib/terms.js`, migration 019). Each customer and vendor
carries `terms` (days), `discountPct` and `discountDays`; `terms` blank means "use the company default"
in Settings, so nothing changes for a contact nobody has set up. `termsLabel()` renders them the way the
trade writes them — *2/10 Net 30*, *Net 30*, *Due on receipt* — and that string prints in the invoice's
Payment Terms box, on screen and in the PDF. **Re-dating a document re-dates it:** changing the date or
the party on a bill or an invoice recomputes the due date through `dueDateFor()`, and so does every
place the store creates one (SO → invoice, PO → bill, proposal phases). A due date typed by hand stays
put until the date or the party changes again.

**Early-payment discounts are offered, never taken automatically.** `discountOffer(db, doc, partyId,
onDate)` answers what the term is worth *on that payment date* — a percentage of the document total,
capped at what is still outstanding — and says `expired` once the window has closed. The Pay / Receive
dialog shows the offer with a **Take $X** button and withdraws it if you move the payment date past the
window; the Pay Bills run offers **Take N available discounts** plus a per-row button. Taking one fills
the Discount column, which drops the cash by the same amount — `settled = paid + discounts` still closes
the document (§6).

**Line-item descriptions are multi-line.** Enter starts a new line in the description field
(`AutoTextarea` in `src/components/ui.jsx`, used by `LineItemsEditor` and the ad-hoc lines in
`InvoiceFromSOModal`); the field grows as you type and the breaks print. Displays that show a
description use `white-space: pre-line`. " — " used to be the way to fake a second line, so it still
breaks — but only in a description that has no real line break of its own, leaving em dashes alone
in anything typed since.

**Invoices print as full pages.** `src/lib/invoiceLayout.js` owns pagination — description wrapping
(52 chars, the Description column at 9pt), how many lines a page holds (13 single-line rows on the
page carrying the totals, 19 on a "continued" page) and the split into pages. Both renderers read it,
so the printable invoice (`DocumentView`) and the PDF (`invoicePdf`, emailed and downloaded) break in
the same places. Each page carries the full frame — company block, Bill To / Ship To, info grid,
"Page: n of m" — the items box is ruled down to the bottom however few lines it holds, and the totals
box sits on the last page only. Changing the frame's height means re-measuring `PAGE_LINES` /
`PAGE_LINES_FULL` against the printable invoice, which is the tighter of the two renderers.

**Public landing page:** `/` is a static page (`app/index.html`) that says whose site this is and what
the software does; the app itself lives at **`/app`** (`app/app/index.html`, the Vite entry that loads
`src/main.jsx`). Two reputation services blocked the domain — a bare credential form on a new domain
with "ledger" in the name reads as wallet phishing — so the root now presents a real business page with
no login form on it, and the sign-in page sits one click away. The build is a Vite multi-page build
(`build.rollupOptions.input` in `vite.config.js`); `vercel.json` and `netlify.toml` route `/app` and
`/app/*` to the app shell and everything else to the landing page. The service worker's
`navigateFallback` is `/app/index.html` and its denylist covers `/` and `/reset`, so the app shell never
answers for the landing page. The PWA's `start_url` is `/app`; installs made before this keep
`start_url: '/'`, so the landing page forwards anything opened in standalone mode (or carrying an auth
token in the URL) straight to `/app`. The footer carries the shop's real address and phone number, and
the same details go out as schema.org `Organization` JSON-LD — a contactable business is the single
strongest signal against a false-positive listing, so keep both in step if they ever change.

**Revision and updates:** the app carries **Rev X.yy** from `app/version.json` — bump `yy` for each
shipped change the shop can see, `X` for a big one — and a **build** stamp (`__BUILD__`: build time plus
the commit sha on Vercel) that vite fills in. `vite.config.js` also writes both to **`/version.json`** in
the build output and serves it in dev; it is in the service worker's `globIgnores` and routed explicitly
in `vercel.json` / `netlify.toml`, so a fetch of it always says what the server has right now.
`src/lib/version.js` — `checkForUpdate()` compares the served build stamp to the running one (a hot-fix
without a rev bump still counts), `updateNow()` unregisters the worker, clears the caches and reloads,
and `useUpdateNudge(toast)` runs the check once a few seconds after load and offers **Update now** on
the toast. **The revision sits at the foot of the menu** (`components/RevisionFoot.jsx`), for every user —
Settings is admin-only, so it used to be out of reach for the rest. It checks on load, every half hour and when
the app comes back into view: *Rev 1.26 · ✓ Up to date*, or an **Update to Rev X** button when the server has a
newer build. Clicking the rev checks again (hover shows the build stamp); *Reload* throws away a copy that seems
stuck. There is no Settings → Revision tab any more.

**Unsticking a cached copy:** the app is a PWA, so a browser can keep serving the build it cached.
The foot of the menu shows the running rev, and its *Reload* / *Update to Rev X*
unregister the service worker and clear the caches. For a device too stuck to reach that button,
**`/reset`** (`app/public/reset.html`) does the same from a standalone page and reports what it
cleared. It is deliberately outside the service worker's reach — `globIgnores` keeps it out of the
precache and `navigateFallbackDenylist` stops the SPA fallback answering for it (`vite.config.js`) —
and both `vercel.json` and `netlify.toml` route `/reset` to it ahead of the SPA catch-all. A worker
installed *before* this change has no such denylist, so on a device still running an older build the
reset page can itself be intercepted; clearing the site's data in the browser is the fallback.

**Print forms:** Settings → Forms holds the named layouts Ledger prints from (`src/lib/forms.js`,
`src/components/FormsEditor.jsx`). Each document type — checks, remittances, invoices — names the form
that prints it. A check form is a field catalogue with per-field *print on/off*, X/Y in inches, and
alignment, plus a page-wide calibration offset for a printer that drifts; the editor shows the sheet to
scale with draggable field chips beside the numeric inputs. **TMJ 3Part Check** is the built-in form for
the shop's LAP98 stock (voucher / check / voucher), measured off a scan of the blank stock laid over a
Ledger test print, so the positions already allow for the printer's drift. The stub columns are the ones
the stock prints — Reference No. · Description · Invoice Date · Invoice Amount · Discount Taken · Amount
Paid — and a totals line of Check Date · Check No. · Payee · Discounts Taken · Check Amount. The two
vouchers' rules don't line up (the bottom Invoice Date column sits 0.14" right of the top one), so the
bottom voucher has its own columns (`colB.*`, "Bottom voucher columns" in the editor); a form that
doesn't set them uses the top voucher's. The ¾" Invoice Date column prints at 8 pt, and a field's own
size beats the default. On the check the payee's name and address print as one block beside PAY TO THE
ORDER OF, where the envelope window shows them (the separate payee line is off), and the memo sits
above the MICR clear band.
*Classic Voucher Check* keeps the old check-on-top layout, and any legacy `settings.check` positions still
drive it. Forms live in the settings jsonb (`settings.forms`, `settings.formFor`) — no migration.
Invoices and remittances keep their standard renderers; they are listed so every document type names its form.

**Discounts taken:** enterable wherever a payment is created or corrected — the single Pay /
Receive dialog, the Pay Bills run (a Discount column; typing one drops the cash by the same
amount and ticks the row), the whole-receipt/payment editor, and the register's line editor.
A discount-only line is legitimate and settles its document with no cash.

**Emailing a remittance:** from the pay-run confirmation (one Email per electronic group,
vendor by vendor) and from any non-check row in Vendors & Purchases → Payments, as well as the single-bill
Pay dialog it was already in. The advice covers the whole payment — every bill the transfer
settled — and goes to the vendor's A/P remittance contact. Checks are excluded: they carry
their own printed stub.

**Pay Bills references:** a pay run groups one payment document per vendor + method
(`groupSel()` in `Payables.jsx`, shared by the dialog and the write). Check groups take
consecutive numbers from the Starting Check #; each electronic group gets its own optional
Reference # field, listed with its vendor, method and subtotal before you record. The reference
prints on the remittance advice and identifies the payment in the register — without one,
two electronic runs to the same vendor on the same day collapse into a single register row.

**Navigation groups:** the sidebar reads Overview · **Customers & Sales** (Customers, Proposals, Quotes,
Sales Orders, Invoices, Receivables) · **Vendors & Purchases** (Vendors, Purchase Orders, Payables,
Payments, Expenses) · **Work** (Jobs, Tasks, Field, Time Tracking, Item Catalog, Fixture Rates) ·
**System** (Chart of Accounts, Journal Entries, Bank Reconciliation, Settings). The group names are labels in `NAV` (`App.jsx`) only, so moving or renaming a
page is a one-line edit there. **Customers and Vendors** are the two halves of the old Contacts page
(`views/Contacts.jsx` with a `type` prop; view keys `customers` / `vendors`, both gated by the
`contacts` permission area, and `go("contacts")` still lands on Customers). A vendor carries a
**Tax ID** (`contacts.tax_id`, migration 022) for the 1099 vendor report to come.

**Fixture Rates** (`views/MachineRates.jsx`, the `machine_types` table — the code and the database keep the
old name) is the costing table behind a fixture proposal, one row per fixture type. Per-unit adders —
`camera_rate`, `torque_rate`, `io_link_rate` (migration 023) — multiply by the count on the proposal
(`specs.cameras` / `torque` / `ioLink`) and roll into the Engineering/Start-Up line; `remote_hmi` and
`remote_sonic` (migration 023) are base-pricing lines of their own with a scope bullet each. The copy button on a row opens a new type with every rate
carried over, named "… (copy)"; a blank or repeated name is refused. **A rate of 0
is left off the proposal**: `priceProposal()` drops any line worth nothing (a 0 rate, an unchecked Data
National, a fixture with no I/O blocks), `buildProposalContent()` drops them again from a pricing snapshot
saved before that rule, and both the printable and the Word export skip the Premium Pricing section when
nothing is in it.

**The phone menu closes on a tap outside it.** Below 900px the sidebar slides over the page; while it's open a
`.nav-scrim` backdrop covers the rest, and tapping it (or Escape) closes the menu without navigating.

**The page area scrolls on its own.** `.app` is one viewport tall and never scrolls; the sidebar stays put
and `.main` is the scroll box, so `go()` scrolls `.main` (and the window, for good measure) to the top.
Printing undoes that (`height:auto; overflow:visible`) or a report would print as one screen. **A wide
table scrolls sideways inside its card** (`.card{overflow-x:auto}`) rather than running off the white,
which is why a row's "⋯" menu is `ActionMenu` (`components/ui.jsx`): the panel is portalled to the body
and pinned from the button's rectangle, because a panel absolutely positioned inside a scrolling card is
clipped by it. **Column headings wrap** (to three lines, `.th-label`) when a table is squeezed, so a long
heading never sets the width of a narrow column; `SortTh` no longer forces `nowrap`.

**General ledger** (`calc/accounts.js`, `calc/gl.js`, migration 024). The chart of accounts is the
`accounts` table (System → Chart of Accounts, `views/Accounts.jsx`; **Load TMJ Chart of Accounts** seeds
the Sage chart from `DEFAULT_ACCOUNTS`). Documents carry the account **number** as text, never a row
id: an invoice its `incomeAccount`, a bill its `expenseAccount`, an expense its `account` and
`cashAccount`, a payment its `cashAccount`. Blank means "use the default", resolved in one place —
`incomeAccountOf()` / `expenseAccountOfBill()` / `expenseAccountOfExpense()` / `cashAccountOf()`: the
document's own account, else the customer's `salesAccount` or the vendor's `expenseAccount`, else
Settings → Accounts (`settings.accounts`: A/R 1100, A/P 2000, cash 1020, sales tax 2310, sales
discounts 4900, purchase discounts 6900, default income 4000, default expense 6750). The store stamps
the resolved income / expense account onto an invoice or bill when it is written, so a later change
to a contact's default leaves issued documents alone. `AccountSelect` (`components/AccountSelect.jsx`)
is the picker every editor uses, filtered by type or balance-sheet group. **Until a chart is loaded the
built-in TMJ chart stands in** (`chart(db)` in `calc/accounts.js`): pickers, labels and every ledger
report name accounts from the first day, and loading the chart only makes it editable.

**The books are kept on a cash basis.** `settings.accounts.basis` is `cash` by default (Settings →
Accounts; `accrual` is the alternative) because the shop's books and tax returns are cash basis.
`journal(db)` posts every document on file by fixed rules so the ledger is in step with the books by
construction. On the **cash basis** nothing posts when an invoice is issued or a bill is entered, and
there is no A/R or A/P on the ledger: a receipt is Dr cash (+ Dr sales discounts) / Cr income for its
share of the invoice subtotal and Cr sales tax for its share of the tax — a partly paid invoice
recognizes revenue as the cash comes in, running totals rounded so the last cent lands on the last
receipt; a bill payment is Dr expense (amount + discount) / Cr cash (+ Cr purchase discounts); an
expense entry Dr expense / Cr cash; a credit note recognizes nothing until cash moves and a credit
applied to an invoice (method `Credit`) is not cash. So the Income Statement's revenue equals the
receipts net of tax, and the Balance Sheet carries no A/R or A/P (Aged Receivables / Payables show
what is open). On the **accrual basis** the documents post when issued — invoice Dr A/R / Cr income +
sales tax; credit note the reverse; receipt Dr cash (+ Dr sales discounts) / Cr A/R; bill Dr expense /
Cr A/P; bill payment Dr A/P / Cr cash (+ Cr purchase discounts). Switching the basis re-derives the
whole ledger; nothing stored changes. `generalLedger()` (per-account activity with opening and
running balances), `trialBalance()`, `incomeStatement()` (the Sage layout: Revenues · Cost of Sales ·
Gross Profit · Expenses · Net Income, for the range and the year to date at its end, with % of
revenue; an account with nothing in either column is left off, so the statement is only as long as
the accounts in use) and `vendor1099()` (each 1099-NEC /
1099-MISC vendor's cash payments in the year — bill payments plus expense entries payable to the
vendor's name — with the $600 limit; a 1099 vendor paid nothing in the year is left off, since no
1099 goes to them) are the four reports under General Ledger / Financial Statements
/ Accounts Payable in Reports. The old cash-basis P&L stays alongside. A number a document names that
the chart lacks still reports, as "(not in chart)". `tools/sage-lists-sql.py` turns the Sage Vendor and
Customer lists into the data fix that fills each contact's account, 1099 type and tax id.

**Year-end close and the balance sheet** (`calc/gl.js`). `journal(db)` ends with one **closing entry per
fiscal year-end that has passed** (`closingEntries()`): every income, cost of sales, expense and
*Equity-gets closed* (Distributions) balance is brought to zero and the difference — net income less
distributions — lands in Retained Earnings (`settings.accounts.retainedEarnings`, default 3910; the
year-end month is `settings.accounts.fiscalYearEndMonth`, default December, both in Settings → Accounts).
The close is derived like everything else, so a bill back-dated into a closed year simply re-closes.
**A closing entry counts from the day after its date**: `throughDate()` gives a Trial Balance or Balance
Sheet dated *on* the year-end the year's income, like Sage's period 12, and one dated the next day shows it
rolled into Retained Earnings; the General Ledger lists the closing lines on the year-end day. The Income
Statement reads `journal(db, { close: false })`, because the close would zero the year it reports.
`balanceSheet(db, asOf)` is the Sage layout — Current Assets · Property and Equipment · Total Assets ·
Current Liabilities · Long-Term Liabilities · Total Liabilities · Capital (the equity accounts, Retained
Earnings as closed, and the income not yet closed as one **Net Income** line) · Total Liabilities & Capital
— zero accounts left off, with an In balance badge (`views/Reports.jsx`, Financial Statements). The books
started in Ledger part-way through the shop's life, so the Sage balances at the cutover (cash, equipment,
loans, Retained Earnings… — on the cash basis no A/R or A/P) belong in one journal entry dated the day
before the first Ledger transaction.

**Locking the books** (migration 030, Settings → Accounts → *Books locked through*, `settings.accounts.lockDate`).
With a lock date set, **the database** refuses to add, delete or change the money on anything dated on or before
it — invoices and their lines, bills, payments/receipts, expenses and journal entries — so a reconciled month or
a filed year can't move. Triggers `lock_*` call `guard_locked_period(<money columns>)`: an update to a locked row
that changes none of the listed columns goes through (marking an invoice printed, notes, due date, PO, number, a
payment's reference); invoice lines are locked with their invoice (`guard_locked_invoice_lines`). It holds for
every device, user and data fix — a data fix on a locked period moves the lock back first. The refusal reads
"The books are locked through Sep 30, 2026…" and `fail()` shows it with a 🔒. *End of Last Month* sets the usual
date. A new payment dated after the lock on an old document is fine. Clear All Data and a backup import are
refused while anything is locked.

**Journal entries by hand** (System → Journal Entries, `views/JournalEntries.jsx`, the `journal_entries`
table, migration 025): what no document covers — a payroll run (Wages Expense, Payroll Tax Expense, 401K
Employer against Checking and the payables), depreciation, an adjustment. An entry is a date, an optional
reference, a memo and any number of lines, each an account with a debit *or* a credit (typing on one side
clears the other; `=` in an amount box, or **Balance on last line**, puts the difference there). It saves
only in balance — `saveJournalEntry()` in `store.js` refuses an unbalanced, one-line, negative or
account-less entry with the precise complaint, and migration 026 puts the same rule on the table as a
trigger, so a row written any other way is refused too — and a new one claims `JE-nnnn` from
`next_doc_number('journal')`. Lines are jsonb on the row (`[{ id, account, desc, debit, credit }]`), the
account as a chart number like every other document. `journal(db)` posts them as written, with a line's
own description shown after the entry memo in the General Ledger, so they land in the GL, the trial
balance and the income statement beside the derived entries. **Copy to new entry** on a row prefills next
month's payroll. Entries wipe with the documents and travel in the JSON backup as `journalEntries`.

**Bank reconciliation** (System → Bank Reconciliation, `views/BankReconciliation.jsx`, `calc/bankRecon.js`,
`lib/bankStatement.js`, migration 027). The register is not a table: `cashRegister(db, account)` is every
ledger line on the cash account, each with a stable key (`receipt:<payment id>`, `payment:<payment id>`,
`expense:<id>`, `journal:<entry id>:<line index>`), so a receipt, a check, an expense entry, a journal line
and the opening-balance entry are all there to tick, and a correction in the books corrects the register.
A reconciliation (`bank_reconciliations`: account, statement ending date and balance, open/done) shows the
items dated on or before the statement that have not cleared on an earlier one; ticking writes the key to
`bank_cleared_items` with the reconciliation it cleared in (a key clears once — unique per org). The
arithmetic carries no "last reconciled balance": **difference = statement balance − Σ every cleared item on
the account**, and Finish needs it at zero. **Book the Difference** prefills a journal entry between the
bank account and Other Income / Service Charge for what is left, and clears it. **Import Statement** reads
the bank's PDF (pdf.js, the lineup reader), a `.csv` export (columns by heading: date, description, amount
or debit/credit, balance, check number) or pasted rows; `parseStatementText()` is keyword-driven — a line
is a transaction when it starts with a date (or a check number and a date) and ends in an amount, the
section heading ("Deposits and additions", "Checks paid"…) sets the sign, a running-balance column
overrides it, and Chase-style check tables with several checks per line are read one check each.
`matchStatement()` pairs each line with an outstanding item by amount and side — the same check number
first, else the nearest date within ten days, else a check number on its own for a slow check — each item
used once. Matched lines are ticked; the rest are **Not in Ledger** with a *Post to* account: money out to
an expense-type account becomes an expense entry (payee guessed from the description), anything else — a
distribution, a loan payment, interest, a transfer — a two-line journal entry, and the new item is ticked
as cleared. A customer receipt the bank has but the books don't is left alone on purpose: it belongs in
Receivables against its invoice. A payment to a **vendor** the books don't have can be posted as a **Vendor bill payment**
instead of a bare expense, so the vendor's account and 1099 stay right: it pays an open bill of theirs, or writes
the bill it should have been (vendor's invoice # defaults to the line's YYMMDD, the vendor's usual expense
account unless one is picked) and pays it — by check when the line has a check number, else ACH / Wire — then
ticks the payment cleared. `suggestVendorPayment()` (`calc/bankRecon.js`) pre-selects it: an open bill for exactly
the amount (narrowed to the vendor the line names), else a vendor whose name's first two words appear in the line.
Apply waits while a vendor row is missing its vendor or invoice #, would overpay its bill, or repeats an invoice #. Reports → Account Reconciliation → **Reconciliation Summary** lists each
statement with its cleared balance, outstanding items and book balance. Cleared keys are not carried by a
JSON backup import, because the import gives payments new ids.

**Company credit cards** (System → Credit Cards, `views/CreditCards.jsx`, `lib/cardStatement.js`, migration 031
`card_statements`). The owner's two cards carry business and personal charges and are paid from checking. Cards
are set up in **Set Up Cards** (`settings.accounts.cards`: `{ id, name, account, match }` — the liability
account, added to the chart as Other Current Liabilities from 2150 up, and the words that name the card's payment
on a bank statement) with the owner-draws account (`settings.accounts.draws`, default 3940 Distributions). Each
month **Import Statement** reads the card's .csv download (one signed Amount column, or Debit/Credit — a file
whose purchases are negative is flipped), a statement PDF, or pasted rows (`parseCardText()`: a line that starts
with one or two dates and ends in an amount; a minus sign or a "Payments / Credits" section makes it a credit;
a closing date, previous and new balance are read off the page, and a year is wound back for a January statement
listing December charges). Payments are skipped (they're the bank side); every other line is marked **Business**
(with an expense account) or **Personal**, pre-filled from how that merchant went on earlier statements
(`merchantKey()` / `learnedChoices()`). The review checks previous balance + every line = new balance. **Post**
(`postCardStatement()`) writes an expense per business line paid from the card's account (Dr expense / Cr card;
a credit is a negative expense), one journal entry for the personal total (Dr Distributions / Cr card, dated the
closing date) and — on a card's first statement, when ticked — the balance it carried from before Ledger
(Dr Retained Earnings / Cr card, Dec 31 2025); a part refused takes the rest back. **Unpost** deletes them all.
In **Bank Reconciliation** a money-out line naming a card (its match words) or equal to a posted statement's
balance defaults to *Post to* the card's account as a journal entry (Dr card / Cr checking) with a note of that
statement's business and personal totals — the charges are already on the books. What a card owes per the books
is its account's balance, shown on the Credit Cards page. Expenses' *Paid From* lists the card accounts too
(`AccountSelect`'s `extra`).

**Network failures on a save:** every PostgREST request goes through `ledgerFetch()` in
`lib/supabaseClient.js` — a request the browser could not send at all ("Failed to fetch", typically
a PWA window waking from sleep) is sent once more after a short pause, and one the server never
answers is abandoned after 30 seconds with a message that says so. `fail()` in `store.js` turns
either into a plain sentence and keeps the toast up long enough to read. If one record keeps timing
out while everything else saves, something is holding its row: `supabase/data-fixes/stuck_locks.sql`
lists the blocking sessions and how to end them.

**Remittance PDFs are named** `<Vendor> Remittance - <Reference #>` (`remittanceFileStem()` in
`src/lib/remittance.js`; the payment date stands in when the transfer has no reference). That is the
attachment name when one is emailed, and it is also written into the PDF's Title metadata, which is
what Chrome's viewer offers in the Save / Print dialog for a PDF opened from a blob URL — the URL itself
has no name to suggest. A pay-run's combined file is named the same way for one vendor and
`Remittances - <date>` for several.

**Marking an invoice printed by hand:** the Invoices list has a **Printed** column — a tick per row
that is the control, not just the status. Ticking marks an invoice printed without printing it (one that
went out by email, or was printed before the flag existed); unticking undoes a slip. With the *Unprinted*
filter on, **Mark all N as printed** does the lot in one write. `markInvoicePrinted(ids, printed)` takes
one id or a list and either value; printing still calls it with the one it printed. Invoices are the only
document with a printed flag.

**Show/hide settled documents:** Payables → Vendor Bills and Receivables → Customer Invoices each
carry a "Show paid" tick with a count, and a Paid column giving the settlement date. Receivables
judges settled on the balance rather than the status, so an unapplied credit — which reads as
"paid" against its own negative total — stays in the open list. **Invoice numbers are editable**
after issue (imports and typos happen); blanks and duplicates are refused in the editor and again
in `saveInvoice`, and only a new invoice can be auto-numbered.

**Tooling:** `tools/reconcile.mjs` checks a JSON backup against a Sage journal export
(Cash Disbursements or Cash Receipts, `.xlsx` or `.csv`, no dependencies) and reports
anything that doesn't match on party, amount, date or reference — including one payment
applied twice to the same document, which is how the original import mis-filed five
payments. `tools/so-report-sql.py` turns a Sage Sales Order Report PDF into a SQL data fix
(kept in `app/supabase/data-fixes/`) that fills blank PO numbers and brings each SO line's
invoiced / closed state into line with Sage's shipped / remaining quantities. See `tools/README.md`.

**The Jobs page counts lines, not percentages:** Progress reads *N available · N invoiced* — available is
ready to invoice (marked ready, not yet billed or closed) — over a bar that fills orange as lines are invoiced
and blue for what's available, and the count column is **Available / Total**.

**Jobs: tracking and costing** (`src/calc/jobs.js`, `views/JobReports.jsx`, migration 028). A job is a sales
order, and it now carries what the shop's job-tracking sheet did: `jobNumber` (the job and fixture, `4724-F3`),
`description`, `specs` (the counts it was priced from — fixture type, sonic gen, horns, I/O blocks, cameras,
Data National…) and `budget` (the proposal's price lines as sold, `[{ key, label, amount }]`, keyed by
`BUDGET_LINES` — the sheet's AE–AM). A won proposal stamps all four onto its SO (`winProposal`); an SO with
no proposal has them typed in on the SO editor or brought in from the sheet (`tools/job-sheet-sql.py`). Where
the SO's own copy is empty, `budgetOf()` / `specsOf()` read the linked proposal. **Three reports:** Accounts
Receivable → **Sales Orders** (each SO's amount, **extras invoiced** — start-up or extra work billed beyond the
order's lines — Open/Closed, left to invoice, outstanding invoices and paid; paid is settled, so Amount + Extras
= Left + Outstanding + Paid, less any line closed unbilled — and a closed line counts as unbilled only as far as
the invoices fall short of the order, since Sage carried some invoiced lines over as closed; detail lists each invoice with the SO lines it billed, then what's left;
left to invoice never exceeds the order less what's been invoiced, which covers a one-line Sage SO invoiced
without its line flagged), Job Reports → **Job Tracking** (every SO plus every proposal not yet won, with each
billing milestone coloured like the sheet: plain not invoiced, blue ready, orange invoiced — `--billed` in
`styles.css`) and **Job Costing** (budget against actual, summary or all columns, a row opens to specs,
budget, actual by category and every cost line). **Actual cost** is read wherever it was booked
(`jobCostItems()`): vendor bills and expenses tagged to the job, by their `costCategory`
(`COST_CATEGORIES` — panel, HMI/bingo, base cables, I/O blocks, Data National material are *material*, the
sheet's L–Q; then field wiring, labor, travel, other); time logged to the job at its snapshot cost rate;
journal-entry lines that name a job (`salesOrderId` + `costCategory` on the jsonb line); and `job_costs` —
costs entered by hand on the Jobs page ($ button), or imported from the sheet (`source: 'sheet'`).
Eng / Profit is revenue less material, as the sheet worked it; Profit is revenue less every cost, where revenue
is the PO plus extras invoiced, less lines closed unbilled.

**Service reports** (Work → Time Tracking, `components/ServiceReports.jsx`, migration 029, `service_reports`): a
visit written up — job, date, technician, problem reported, work performed, follow-up, parts used and hours.
Numbered `SR-0001…` from `next_doc_number('service')`. The hours are ordinary **time entries** carrying
`serviceReportId`, so they're approved and billed like any time; an edit rewrites the report's un-invoiced
entries and keeps their approval unless the hours or category changed, and an invoiced entry is locked. A part
ticked **Bill** with a price is added to the job's sales order as a **ready** line (`{desc} (SR-…)`), once —
`parts[].soLineId` remembers it — which raises the job's invoice task. Picking **+ New job…** opens a sales
order on save (customer, job #, description, optional PO; a job # already in use is refused) so the visit
bills like any job. Anyone who can log time can write one (`timeTracking` / `field` / `jobs`); members see
their own, admins see all. Deleting a report deletes its hours unless any are invoiced; billed parts stay on
the job. Hours logged to a job and not yet invoiced keep it open in the Sales Order and Job Tracking reports
(`soSummary()`), since a service job can be nothing but time. Internal only — no printed report.

**Sales order numbers** run on from the Sage series: `nextSoNumber()` in `store.js` is the SO prefix plus the
next number with no dash or padding (`TMJ915`), used by every place an SO is created (new SO, won proposal,
service-report job). The `so` sequence was set to 915 on 2026-10-08 (`data-fixes/2026-10-08_so_counter_915.sql`).

**Team activity becomes tasks.** `noteActivity()` in `store.js` raises a `type: "review"` task whenever someone
other than the org owner logs time, writes or updates a service report, creates or edits a sales order, marks a
job line ready / not ready, closes or reopens one, adds, changes or deletes a job cost, or creates a quote or a
proposal. One open task per subject and person (the title, `"Job updated TMJ915 · 4810 — tech@…"`): a second
change updates that task's detail rather than adding another. It never fails the action that raised it. Tasks
shows them as **Team Activity** (Open → the page it's about, `reviewTarget()` in `lib/taskKinds.js`; Done; Mark
All Done) above **Ready to Invoice**, and the dashboard leads with an **Open Tasks** card (team activity plus
jobs ready to invoice) for anyone with the Tasks page.

**Sortable lists:** every list view — Quotes, Sales Orders, Invoices, Receivables, Payables,
Purchase Orders, Expenses, Customers, Vendors, Catalog, Jobs, Tasks, Proposals, Fixture Rates, Job Costing,
Time Tracking, the Payments/Receipts register, and the report tables — sorts on any column heading,
ascending then descending. See §7 for the convention new pages follow.

**Not built (candidates for next work):** refunds (returning cash rather than crediting) · partial invoicing of an SO ·
recurring invoices · email sending · attachments / receipt photos · quote line-item reordering ·
multi-user roles · a live bank feed (statements are imported by file) · locking a closed year against
back-dated documents ·
undo · automated tests ·
Capacitor store apps (PWA covers home-screen install today).

---

## 9. Known limitations & gotchas

- **Single browser only.** `localStorage` is per-origin, per-browser. No sync. JSON export is the
  only backup. This is the #1 thing the Supabase migration fixes.
- **CDN dependency on first load** (React, Babel, fonts). Offline-first needs vendored assets or a bundler.
- **In-browser Babel** adds a transpile cost on every load and ships an unminified app. Fine for
  internal use; move to a build step if it grows.
- **Deletes don't cascade.** Deleting a quote/SO leaves the downstream SO/invoice with a dangling
  `quoteId`/`salesOrderId`. `nameOf`/lookups handle missing refs gracefully ("—"), but consider
  guarding deletes or cascading when you add integrity rules.
- **No concurrency control.** Two tabs = last write wins; counters could collide.
- **Floats.** Comparisons use epsilons; keep using `round2` and epsilon checks for money.
- **`prompt()`/`confirm()`** are used for PO entry and delete confirms — quick but not styled.
  Replace with modals if polishing UX.

---

## 10. Roadmap (suggested priority)

1. **Supabase backend + sync** (see §11) — highest value; removes the single-browser limitation.
   Pairs naturally with auth.
2. **Auth / multi-user** — Supabase Auth; scope all rows to a user/org id with RLS.
3. **Reporting** — P&L (revenue from paid invoices − expenses), sales-tax collected, A/R & A/P
   summaries over a date range. All derivable from current data.
4. **Standalone invoices & partial invoicing** — invoice without an SO; invoice part of an SO and
   track remaining balance to fulfill.
5. **Credit notes / refunds** — negative documents or a `credits[]` collection applied to invoices.
6. **Recurring invoices** — template + schedule generator (you've built schedule generators before).
7. **Build tooling** — optional Vite migration if the single file gets unwieldy; keep the single-file
   version as the "lite" distributable if useful.
8. **UX polish** — styled confirm/PO modals, drag-reorder line items, keyboard shortcuts.

Work action-first: implement with reasonable assumptions and note them, rather than over-clarifying.

---

## 11. Supabase migration plan

The app is deliberately structured so the backend swaps in at one seam: the persistence layer
(§3). Recommended approach:

**Phase 1 — schema.** One table per collection. Suggested tables (snake_case), all with
`id uuid pk`, `user_id uuid` (for RLS), `created_at`:

| Table | Key columns |
|---|---|
| `settings` | one row per user; the settings fields as columns or a single `jsonb` |
| `contacts` | `type`, `name`, `contact`, `email`, `phone`, `address` |
| `catalog_items` | `desc`, `unit`, `unit_price` |
| `quotes` | `number`, `customer_id`, `date`, `expiry_date`, `status`, `po_number`, `tax_rate`, `notes`, `sales_order_id` |
| `quote_line_items` | `quote_id`, `desc`, `qty`, `unit`, `unit_price`, `sort` |
| `sales_orders` | `number`, `quote_id`, `customer_id`, `po_number`, `date`, `status`, `tax_rate`, `invoice_id` |
| `sales_order_line_items` | `sales_order_id`, … |
| `invoices` | `number`, `sales_order_id`, `quote_id`, `customer_id`, `po_number`, `date`, `due_date`, `tax_rate` |
| `invoice_line_items` | `invoice_id`, … |
| `payments` | `parent_type` (`invoice`/`bill`), `parent_id`, `amount`, `date`, `method` |
| `bills` | `number`, `vendor_id`, `date`, `due_date`, `amount`, `ref`, `notes` |
| `expenses` | `date`, `category`, `vendor`, `amount`, `method`, `notes` |

Decision to make up front: **normalized line-item tables** (rows above) vs. keeping `line_items`
as a `jsonb` column on the parent. Jsonb is the smaller diff from today's shape and fine for an
internal tool; normalized tables are cleaner for reporting/SQL. Pick per your reporting appetite.

Sequence numbers: move `counters` into `settings` (or a `sequences` table) and increment inside a
Postgres function / transaction to avoid the concurrency gap in §9.

**Phase 2 — data layer.** Replace `loadState`/`saveState` and the direct `setDb` mutations with a
thin data module (`db.js` or inline) exposing async CRUD per collection backed by `supabase-js`.
Keep the in-memory shape identical to today so the view components barely change: load all
collections into the same `db` object on start, and on each mutation write through to Supabase then
update local state. Later, swap polling for Supabase Realtime subscriptions for live sync.

**Phase 3 — auth + RLS.** Add Supabase Auth (email or magic link), stamp `user_id` on all rows,
enable Row Level Security so users only see their own data.

**Migration of existing data:** the JSON backup from Settings is a full dump — write a one-off
import that maps each array into its table.

Keep this single-file version working until the Supabase version reaches parity; it's a useful
reference implementation and offline fallback.

---

## 12. Working style notes

- Preserve the invariants in §6 and the design conventions in §7 unless a task changes them on purpose.
- All state changes through `setDb`; all money/date formatting through the helpers.
- When adding a module, mirror an existing one (list `card` + `table` + `Empty` + modal/inline editor).
- Prefer building with stated assumptions over long clarifying rounds; call out assumptions in your summary.
- If a change spans the whole file or starts the backend split, sketch the plan before large edits.
