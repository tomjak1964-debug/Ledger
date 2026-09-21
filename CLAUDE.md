# Ledger — Quote-to-Cash Accounting App

Project context for Claude Code. Keep this file (`CLAUDE.md`) next to `ledger.html` at the repo
root so it's read automatically as session context.

---

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
Payables (vendor bills, A/P aging, payments) · Expenses (by category) · Contacts (customers/vendors) ·
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
(`src/components/PaymentRegister.jsx`, shown as Spend → Payments and Receivables → Receipts:
search, date range, edit, delete, void a whole check; both sides list one row per
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
on a list of what was created, with a Print button per invoice. The dialog closes itself after a
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

**Unsticking a cached copy:** the app is a PWA, so a browser can keep serving the build it cached.
Settings → Account shows the running build (`__BUILD__`, the commit sha) and *Load Latest Version*
unregisters the service worker and clears the caches. For a device too stuck to reach that button,
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
the shop's stock (voucher / check / voucher, measured off the blank: panels at 0.45–3.38", 3.5–7.0",
7.62–10.54"; column rules at 0.084 / 1.109 / 3.508 / 4.267 / 5.722 / 6.860 / 8.298"), with the stub
columns the stock prints — Reference No. · Description · Invoice Date · Invoice Amount · Discount Taken ·
Amount Paid — and a totals line of Check Date · Check No. · Payee · Discounts Taken · Check Amount.
*Classic Voucher Check* keeps the old check-on-top layout, and any legacy `settings.check` positions still
drive it. Forms live in the settings jsonb (`settings.forms`, `settings.formFor`) — no migration.
Invoices and remittances keep their standard renderers; they are listed so every document type names its form.

**Discounts taken:** enterable wherever a payment is created or corrected — the single Pay /
Receive dialog, the Pay Bills run (a Discount column; typing one drops the cash by the same
amount and ticks the row), the whole-receipt/payment editor, and the register's line editor.
A discount-only line is legitimate and settles its document with no cash.

**Emailing a remittance:** from the pay-run confirmation (one Email per electronic group,
vendor by vendor) and from any non-check row in Spend → Payments, as well as the single-bill
Pay dialog it was already in. The advice covers the whole payment — every bill the transfer
settled — and goes to the vendor's A/P remittance contact. Checks are excluded: they carry
their own printed stub.

**Pay Bills references:** a pay run groups one payment document per vendor + method
(`groupSel()` in `Payables.jsx`, shared by the dialog and the write). Check groups take
consecutive numbers from the Starting Check #; each electronic group gets its own optional
Reference # field, listed with its vendor, method and subtotal before you record. The reference
prints on the remittance advice and identifies the payment in the register — without one,
two electronic runs to the same vendor on the same day collapse into a single register row.

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
payments. See `tools/README.md`.

**Sortable lists:** every list view — Quotes, Sales Orders, Invoices, Receivables, Payables,
Purchase Orders, Expenses, Contacts, Catalog, Jobs, Tasks, Proposals, Machine Rates, Job Costing,
Time Tracking, the Payments/Receipts register, and the report tables — sorts on any column heading,
ascending then descending. See §7 for the convention new pages follow.

**Not built (candidates for next work):** refunds (returning cash rather than crediting) · partial invoicing of an SO ·
recurring invoices · email sending · attachments / receipt photos · quote line-item reordering ·
multi-user roles · bank import / reconciliation · double-entry GL · undo · automated tests ·
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
