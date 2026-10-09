-- Migration 031 — company credit card statements. Run ONCE after 030 (safe to re-run).
-- Additive only.
--
-- The shop's cards carry business and personal charges and are paid from the
-- business checking account. Each month a card's statement is imported
-- (System → Credit Cards), every charge is marked business or personal, and
-- posting it writes:
--   · an expense entry per business charge, paid from the card's liability
--     account (Dr expense / Cr card), so it lands on the books on its own date;
--   · one journal entry for the personal charges, Dr Distributions / Cr card
--     (the owner's draws), dated the statement's closing date;
--   · on a card's first statement, optionally its balance from before Ledger
--     started, Dr Retained Earnings / Cr card, dated Dec 31, 2025.
-- The payment from checking is then a bank reconciliation line posted to the
-- card's account (Dr card / Cr checking), which clears what the card owes.
--
-- lines: [{ id, date, desc, amount, kind: charge|credit|payment, use:
-- business|personal|skip, account, expenseId }] — amount positive for a
-- charge, negative for a credit or payment, as the card company prints it.
-- The cards themselves (name, liability account, words that name it on a bank
-- statement) live in settings.accounts.cards; no table.
create table if not exists card_statements (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid default default_org(),
  card_account     text not null,
  card_name        text not null default '',
  closing_date     date not null,
  period_from      date,
  previous_balance numeric(14,2),
  new_balance      numeric(14,2),
  business_total   numeric(14,2) not null default 0,
  personal_total   numeric(14,2) not null default 0,
  lines            jsonb not null default '[]'::jsonb,
  draw_entry_id    uuid references journal_entries(id) on delete set null,
  opening_entry_id uuid references journal_entries(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (org_id, card_account, closing_date)
);

-- Posting writes journal entries, so it takes the same right as they do.
alter table card_statements enable row level security;
drop policy if exists card_statements_read  on card_statements;
drop policy if exists card_statements_write on card_statements;
create policy card_statements_read on card_statements for select
  using (org_id in (select member_orgs()) and (can_read('settings') or can_read('expenses')));
create policy card_statements_write on card_statements for all
  using (org_id in (select member_orgs()) and can_write('settings'))
  with check (org_id in (select member_orgs()) and can_write('settings'));
