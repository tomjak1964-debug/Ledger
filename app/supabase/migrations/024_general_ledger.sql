-- Migration 024 — the general ledger. Run ONCE after 023 (safe to re-run).
--
-- accounts: the chart of accounts, one row per account (System → Chart of
-- Accounts; "Load TMJ Chart of Accounts" seeds the Sage chart). Documents
-- carry the account NUMBER as text — an invoice remembers the income account
-- it was booked to, a bill its expense account, a payment the cash account it
-- moved through — so the ledger (src/calc/gl.js) is derived from the
-- documents themselves and a later change to a contact's default leaves
-- issued documents alone. Blank means "use the default": the contact's
-- account, then Settings → Accounts.
--
-- contacts.sales_account / expense_account: where a customer's invoices and a
-- vendor's bills post by default (the Sage Customer List "Sales Acct" and
-- Vendor List "Expense Accnt"). contacts.ten99: '' | 'nec' | 'misc', which
-- vendors the 1099 Vendor Report lists.

create table if not exists accounts (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid default default_org(),
  number     text not null default '',
  name       text not null default '',
  type       text not null default 'Expenses',
  active     boolean not null default true,
  sort       int not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists accounts_org_number_idx on accounts(org_id, number);

alter table accounts enable row level security;
drop policy if exists accounts_read  on accounts;
drop policy if exists accounts_write on accounts;
create policy accounts_read  on accounts for select using (org_id in (select member_orgs()));
create policy accounts_write on accounts for all
  using (org_id in (select member_orgs()) and can_write('settings'))
  with check (org_id in (select member_orgs()) and can_write('settings'));

alter table contacts add column if not exists sales_account   text not null default '';
alter table contacts add column if not exists expense_account text not null default '';
alter table contacts add column if not exists ten99           text not null default '';

alter table invoices add column if not exists income_account  text not null default '';
alter table bills    add column if not exists expense_account text not null default '';
alter table expenses add column if not exists account         text not null default '';
alter table expenses add column if not exists cash_account    text not null default '';
alter table payments add column if not exists cash_account    text not null default '';
