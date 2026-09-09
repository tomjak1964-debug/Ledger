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
