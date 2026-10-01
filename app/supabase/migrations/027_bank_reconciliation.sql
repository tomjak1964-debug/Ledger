-- Migration 027 — bank reconciliation. Run ONCE after 026 (safe to re-run).
--
-- bank_reconciliations: one row per statement reconciled (System → Bank
-- Reconciliation): the cash account (a chart number), the statement's ending
-- date and balance, and whether it is still open or finished.
--
-- bank_cleared_items: which register items have cleared the bank, by the
-- stable key the app gives every cash line of the ledger (src/calc/bankRecon.js:
-- receipt:<id> · payment:<id> · expense:<id> · journal:<id>:<line>), with the
-- reconciliation each cleared in and its signed amount. The bank's balance is
-- the sum of every cleared item, so a reconciliation is done when the
-- statement balance equals that sum. A key clears once.

create table if not exists bank_reconciliations (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid default default_org(),
  account           text not null default '',
  statement_date    date not null default current_date,
  statement_balance numeric(14,2) not null default 0,
  status            text not null default 'open',       -- open | done
  notes             text not null default '',
  finished_at       timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists bank_reconciliations_org_idx on bank_reconciliations(org_id, account, statement_date);

create table if not exists bank_cleared_items (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid default default_org(),
  reconciliation_id uuid not null references bank_reconciliations(id) on delete cascade,
  account           text not null default '',
  item_key          text not null,
  item_date         date,
  amount            numeric(14,2) not null default 0,
  created_at        timestamptz not null default now()
);
create unique index if not exists bank_cleared_items_key_idx on bank_cleared_items(org_id, item_key);
create index if not exists bank_cleared_items_recon_idx on bank_cleared_items(reconciliation_id);

alter table bank_reconciliations enable row level security;
alter table bank_cleared_items   enable row level security;
drop policy if exists bank_reconciliations_read  on bank_reconciliations;
drop policy if exists bank_reconciliations_write on bank_reconciliations;
drop policy if exists bank_cleared_items_read    on bank_cleared_items;
drop policy if exists bank_cleared_items_write   on bank_cleared_items;
create policy bank_reconciliations_read  on bank_reconciliations for select using (org_id in (select member_orgs()));
create policy bank_reconciliations_write on bank_reconciliations for all
  using (org_id in (select member_orgs()) and can_write('settings'))
  with check (org_id in (select member_orgs()) and can_write('settings'));
create policy bank_cleared_items_read  on bank_cleared_items for select using (org_id in (select member_orgs()));
create policy bank_cleared_items_write on bank_cleared_items for all
  using (org_id in (select member_orgs()) and can_write('settings'))
  with check (org_id in (select member_orgs()) and can_write('settings'));
