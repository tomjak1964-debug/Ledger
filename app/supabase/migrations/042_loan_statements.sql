-- System → Line of Credit: each month's line of credit statement, imported and
-- posted as journal entries (lib/loanStatement.js, views/LineOfCredit.jsx).
--   interest charged  Dr interest expense   Cr the line      (on the closing date)
--   fees              Dr service charges    Cr the line
--   payment           Dr the line           Cr checking      (its own entry, its own date)
--   advance (draw)    Dr checking           Cr the line
-- A payment or draw already on the books (posted from Bank Reconciliation) is
-- linked, not entered twice. lines jsonb:
--   [{ id, date, postDate, desc, amount, kind, entryId, linked }]
create table if not exists loan_statements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid default default_org(),
  loan_account text not null,
  loan_name text not null default '',
  closing_date date not null,
  period_from date,
  previous_balance numeric(14,2),
  new_balance numeric(14,2),
  lines jsonb not null default '[]'::jsonb,
  charges_entry_id uuid references journal_entries(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, loan_account, closing_date)
);
alter table loan_statements enable row level security;
drop policy if exists loan_statements_read  on loan_statements;
drop policy if exists loan_statements_write on loan_statements;
create policy loan_statements_read on loan_statements for select
  using (org_id in (select member_orgs()) and (can_read('settings') or can_read('expenses')));
create policy loan_statements_write on loan_statements for all
  using (org_id in (select member_orgs()) and can_write('settings'))
  with check (org_id in (select member_orgs()) and can_write('settings'));
grant select, insert, update, delete on loan_statements to authenticated;
