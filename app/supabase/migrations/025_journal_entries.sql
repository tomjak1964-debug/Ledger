-- Migration 025 — manual general journal entries. Run ONCE after 024 (safe to re-run).
--
-- journal_entries: what the shop books by hand — a payroll run (wages,
-- employer taxes, 401K), depreciation, an adjustment — one row per entry with
-- its lines as jsonb: [{ id, account, desc, debit, credit }]. Every entry
-- balances (the app refuses to save one that doesn't) and posts to the
-- general ledger alongside the entries derived from documents (src/calc/gl.js).
-- Numbers come from next_doc_number('journal') — JE-0001 — so two people
-- can't claim the same one.

create table if not exists journal_entries (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid default default_org(),
  number     text not null default '',
  date       date not null default current_date,
  ref        text not null default '',
  memo       text not null default '',
  lines      jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists journal_entries_org_date_idx on journal_entries(org_id, date);

alter table journal_entries enable row level security;
drop policy if exists journal_entries_read  on journal_entries;
drop policy if exists journal_entries_write on journal_entries;
create policy journal_entries_read  on journal_entries for select using (org_id in (select member_orgs()));
create policy journal_entries_write on journal_entries for all
  using (org_id in (select member_orgs()) and can_write('settings'))
  with check (org_id in (select member_orgs()) and can_write('settings'));
