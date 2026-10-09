-- Migration 029 — service reports. Run ONCE after 028 (safe to re-run).
-- Additive only.
--
-- A service report is a visit written up on Work → Time Tracking: the job it
-- was for, the date and who did it, what was reported and what was done, any
-- follow-up, and the parts used. Its hours are ordinary time entries that
-- point back at it (time_entries.service_report_id), so they're approved,
-- billed and costed like any other time. Parts ride along as jsonb:
--   [{ id, desc, qty, unitPrice, bill, soLineId }]
-- A part ticked "bill" with a price is added to the job's sales order as a
-- line marked ready to invoice; soLineId remembers that line so a later edit
-- doesn't add it twice. Numbers are SR-0001… from next_doc_number('service').
create table if not exists service_reports (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid default default_org(),
  number         text not null default '',
  sales_order_id uuid references sales_orders(id) on delete set null,
  date           date not null default current_date,
  user_email     text not null default '',
  problem        text not null default '',
  work_performed text not null default '',
  follow_up      text not null default '',
  parts          jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists service_reports_org_date_idx on service_reports(org_id, date);

alter table time_entries add column if not exists service_report_id uuid references service_reports(id) on delete set null;

-- Whoever can log time can write a service report (time tracking, the field
-- app, or jobs); invoicing can read them.
alter table service_reports enable row level security;
drop policy if exists service_reports_read  on service_reports;
drop policy if exists service_reports_write on service_reports;
create policy service_reports_read on service_reports for select
  using (org_id in (select member_orgs()) and (can_read('timeTracking') or can_read('field') or can_read('jobs') or can_read('invoices')));
create policy service_reports_write on service_reports for all
  using (org_id in (select member_orgs()) and (can_write('timeTracking') or can_write('field') or can_write('jobs')))
  with check (org_id in (select member_orgs()) and (can_write('timeTracking') or can_write('field') or can_write('jobs')));
