-- Migration 028 — job tracking and job costing. Run ONCE after 027 (safe to re-run).
-- Additive only: new columns default to empty, so older code reads past them.
--
-- A job is a sales order. It now carries what the shop's job-tracking sheet
-- did and the SO lacked:
--   job_number   "4724-F3" — the job and, after a dash, the fixture within it
--   description  what the fixture is ("Tray Support Bracket")
--   specs        the counts the price was built from (fixture type, sonic
--                generators, horns, cameras, I/O blocks, Data National…)
--   budget       the proposal's price lines as sold: [{ key, label, amount }]
-- A won proposal copies all four onto its SO; for an SO with no proposal they
-- are typed in, or came from the sheet.
alter table sales_orders add column if not exists job_number  text  not null default '';
alter table sales_orders add column if not exists description text  not null default '';
alter table sales_orders add column if not exists specs       jsonb not null default '{}'::jsonb;
alter table sales_orders add column if not exists budget      jsonb not null default '[]'::jsonb;

-- Which job-cost bucket a bill or expense tagged to a job lands in (panel,
-- hmi, cables, ioBlocks, dnMaterial, fieldWiring, labor, travel, other —
-- COST_CATEGORIES in src/calc/jobs.js). Blank reads as "other".
alter table bills    add column if not exists cost_category text not null default '';
alter table expenses add column if not exists cost_category text not null default '';

-- job_costs: a cost booked to a job by hand — a panel shop's quote before the
-- bill arrives, a cost carried over from the old sheet, hours worked off the
-- clock. Bills, expenses, time entries and journal lines tagged to the job are
-- read where they live; this table is only for what has no document.
create table if not exists job_costs (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid default default_org(),
  sales_order_id uuid not null references sales_orders(id) on delete cascade,
  date           date not null default current_date,
  category       text not null default 'other',
  description    text not null default '',
  hours          numeric(12,2) not null default 0,
  amount         numeric(14,2) not null default 0,
  source         text not null default 'manual',   -- 'manual' | 'sheet' (imported)
  created_at     timestamptz not null default now()
);
create index if not exists job_costs_org_so_idx on job_costs(org_id, sales_order_id);

alter table job_costs enable row level security;
drop policy if exists job_costs_read  on job_costs;
drop policy if exists job_costs_write on job_costs;
create policy job_costs_read  on job_costs for select
  using (org_id in (select member_orgs()) and (can_read('jobs') or can_read('salesOrders')));
create policy job_costs_write on job_costs for all
  using (org_id in (select member_orgs()) and can_write('jobs'))
  with check (org_id in (select member_orgs()) and can_write('jobs'));
