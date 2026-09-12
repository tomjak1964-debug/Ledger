# tools

## reconcile.mjs — Ledger vs. a Sage journal

```
node tools/reconcile.mjs <backup.json> <journal.xlsx|.csv> [--kind bill|invoice]
```

`backup.json` is Settings → Data → **Export Backup (JSON)**. The journal is a
Sage export — Cash Disbursements for the money-out side, Cash Receipts for the
money-in side. `.xlsx` and `.csv` both work; no npm install is needed, the
reader is built in.

`--kind` defaults to `invoice` when the filename mentions "receipt", otherwise
`bill`. Pass it explicitly if your export is named something else.

### What it reports

Sage is the book of record. Every journal line is matched to a ledger payment
on **party + amount + date**, within the journal's own date window, and the
tool prints whatever doesn't line up:

- totals on each side, and the difference
- lines in Sage with no matching payment
- payments with no matching Sage line
- payments missing the check or reference number Sage has
- payments whose reference disagrees with Sage
- **one payment applied twice to the same document** — the signature of the
  import bug described below

Exit code is 0 when everything matches, 1 when it doesn't, so it can gate a
script.

### Why it exists

The original Sage import matched each disbursement to a bill by the Sage
`Invoice:` reference alone, ignoring which party the money went to. For
subcontractors those references are date-coded (`260105` = 5 Jan 2026), so two
vendors paid for the same period shared one reference — and the second vendor's
payment was filed onto the first vendor's bill, with its amount folded into
that bill's total. Five payments landed that way, and Sage's two vendor credit
memos were dropped entirely. Both were fixed in September 2026; run this after
any future import to catch the same class of error early.

### Reading the journal

A Sage journal row is `Date | Check # | Account ID | Line Description | Debit |
Credit`, and rows arrive in blocks: the document lines of one payment
(`Invoice: 260402`), then the cash line whose description names the party. The
tool keys off the party name rather than the account number, so the same reader
handles both journals, and it takes the direction of the cash line to decide the
sign — money out and money in both come through as positive amounts. Footer and
subtotal rows are skipped.

If it stops with *"had no party line after them"*, a name in the journal isn't
in Contacts under the expected type — a vendor for a disbursements journal, a
customer for a receipts journal. Add the contact, or correct the spelling, and
run it again.

## so-report-sql.py — bring sales orders into line with a Sage Sales Order Report

```
pip install pdfplumber
python3 tools/so-report-sql.py --preview "Import/Sales Order Report 09122026.pdf" \
  > app/supabase/data-fixes/2026-09-12_sales_order_report_preview.sql
python3 tools/so-report-sql.py "Import/Sales Order Report 09122026.pdf" \
  > app/supabase/data-fixes/2026-09-12_sales_order_report_apply.sql
```

The input is Sage's **Sales Order Report** printed to PDF, ordered by sales
order number with shortened descriptions — one block per open order, one row
per line with Qty Ordered / Shipped / Remaining. The output is SQL to paste
into the Supabase SQL editor (Dashboard → SQL). Generated scripts are kept in
`app/supabase/data-fixes/` so the change is on record.

Each output is **one statement** — a single `WITH` chain ending in a `SELECT` —
because the Supabase SQL editor runs every statement on its own connection, so
temp tables, `BEGIN` and `COMMIT` don't carry from one to the next. One
statement is also atomic on its own: it applies completely or not at all.

Run the **preview** first: it reads only and returns the same review table the
apply script does, showing exactly what would change. Then run **apply**.

### What the apply script does

Sage is the book of record, so every sales order on the report is made to match it:

- **PO numbers** — a blank `po_number` is filled from the job number that
  prefixes each line (`4763 Initial PO` → PO `4763`). A PO already entered is
  never overwritten.
- **Invoiced lines** — a line Sage has shipped is marked `invoiced` and linked
  to the Ledger invoice that billed it: an invoice on the same sales order with
  a line of the same text (earliest wins). Lines closed by hand to hide them
  from "to invoice" are un-closed and marked invoiced instead.
- **Open lines** — a line Sage still has remaining is reopened (`invoiced` off,
  `closed` off, `invoice_id` cleared) so it is available to bill again.
- **Status** — each sales order's `status` / `invoice_id` is recomputed from its
  lines, the same rule the app uses.

Report lines match Ledger lines by the shortened description as a prefix of the
full one (case, spacing and punctuation ignored); if the text differs — Sage's
`2743F Panel Build Compl` on TMJ892, for instance — the line at the same
position is used, provided nothing else claimed it. Sales orders not on the
report are untouched. Running apply twice changes nothing the second time.

### Reading the result

Both scripts return one row per report line: the Sage line, the Ledger line it
matched, what it was, what it is now, the linked invoice, and a note. Look for:

- **NO LEDGER LINE MATCHED** — the sales order in Ledger is missing that line;
  add it and rerun.
- **invoiced in Sage, no Ledger invoice found** — the line is marked invoiced so
  it will not be billed twice, but there is no invoice in Ledger to link. Enter
  or import the invoice, then rerun apply to link it.
- **unlinked invoice …** — Sage still shows the line open, but Ledger had an
  invoice on it. Check which side is right before applying.
