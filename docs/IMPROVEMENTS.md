# Ledger improvements — working list

Agreed with Tom on 2026-11-14 ("do all the things you recommended, in order"). Tick each item when it
is merged and live; note anything blocked and what it waits on. Keep this file current — it is the
list, not the conversation.

## 1. Protect what's already done
- [x] **Lock the books through 2026-10-31** (done 2026-11-14, data-fixes/2026-11-14_lock_books_through_oct.sql) (Settings → Accounts → Books locked through). Bank reconciled
      through Oct 31, both cards posted through October. Data change: backup first.
- [x] **Month-End Close page** (Rev 1.92) — per month: bank reconciled, each card statement posted, line of credit
      statement posted, payroll entry made, nothing left ready to invoice → *Lock the month*.
- [x] **Automated tests for the money logic** (20 tests, `npm test`) — journal (cash/accrual, credit memo netted into a receipt,
      itemized bills), bank matching (named payee first, groups, receipts under another date), statement
      parsers (PNC checking, PNC line of credit, card), aging. Runs with `npm test`.

## 2. Save time each month
- [ ] **Payroll import (ADP)** — BLOCKED: needs a sample ADP payroll report from Tom.
- [x] **Cash-flow forecast** (Rev 1.93) on the dashboard — next 4–8 weeks: invoices by due date in; bills due,
      payroll, line-of-credit payment, card balances out; the low point.
- [ ] **PNC Payments API** (instant payments from Ledger + bank feed) — blocked: Tom to ask PNC about the
      API channel, cost, approval in PINACLE, limits; then a Developer Portal sandbox app.

## 3. Year-end (January)
- [x] **W-9s:** R&H Witt Inc, Tailored Controls Design LLC, Unlimited Technologies have no Tax ID (none paid
      in 2026, so no 1099 due this year). Told Tom 2026-11-14.
- [x] **Year-End checklist** (Rev 1.94, on the Month-End Close page) — close the year, 1099 check (vendors over $600 without a Tax ID),
      accountant's reports, opening balances, lock the year.

## 4. Everyday polish
- [x] **Global search opens the record** (Rev 1.95) (invoice, bill, proposal, SO, contact) instead of just the page.
- [x] **Excel (.xlsx) exports** instead of CSV (Rev 1.96).
- [x] **Back button / DocActions toolbar** consistency (Rev 1.97) on Reports, quotes and purchase orders (standards gaps).
- [ ] **Recurring invoices and bills.**

## 5. Housekeeping
- [ ] **Trim CLAUDE.md** (1,380 lines) to the skeleton the standards call for; move the feature detail into
      `docs/` pages it links to.
