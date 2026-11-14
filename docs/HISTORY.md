# Ledger — history

Moved out of CLAUDE.md on 2026-11-14 (standards S6.3): the documentation of the original single-file `ledger.html`
(its architecture, file map and localStorage data model), and the roadmap, limitations and Supabase migration plan written
before `app/` existed. Kept for reference; `app/` on the self-hosted backend is the app.

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

