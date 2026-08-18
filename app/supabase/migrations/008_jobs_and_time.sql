-- Migration 008 — job progress + tasks + time tracking (Round 3).
-- Run ONCE in the Supabase SQL editor, AFTER 006 and 007. Idempotent guards.
--
-- A "job" is a Sales Order. Its line items can be marked 'ready' (work complete)
-- as progress is made; when un-invoiced ready items exist, a task is raised for
-- an invoice-authorized user to bill them. Two new access areas gate this:
--   'jobs'         — view jobs and mark line items ready
--   'timeTracking' — log time against jobs
-- Admins manage time categories + rates.

-- ───────────────────── job progress ─────────────────────
alter table sales_order_line_items add column if not exists ready boolean not null default false;

-- ───────────────────── tasks ─────────────────────
create table if not exists tasks (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid default default_org(),
  type            text not null default 'create_invoice',
  status          text not null default 'open' check (status in ('open','done','dismissed')),
  sales_order_id  uuid references sales_orders(id) on delete cascade,
  title           text not null default '',
  detail          text not null default '',
  created_by      text not null default '',
  done_by         text not null default '',
  created_at      timestamptz not null default now(),
  done_at         timestamptz
);
create index if not exists tasks_org_idx on tasks(org_id);
create index if not exists tasks_so_idx on tasks(sales_order_id);

-- ───────────────────── time tracking ─────────────────────
create table if not exists time_categories (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid default default_org(),
  name       text not null default '',
  rate       numeric(12,2) not null default 0,   -- flat billing rate per hour
  active     boolean not null default true,
  sort       int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists time_entries (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid default default_org(),
  user_email     text not null default '',       -- who logged it
  sales_order_id uuid references sales_orders(id) on delete set null,
  category_id    uuid references time_categories(id),
  date           date,
  hours          numeric(10,2) not null default 0,
  rate           numeric(12,2) not null default 0, -- snapshot of the category rate
  description    text not null default '',
  invoice_id     uuid,                            -- set once billed onto an invoice
  created_at     timestamptz not null default now()
);
create index if not exists time_entries_org_idx on time_entries(org_id);
create index if not exists time_entries_so_idx on time_entries(sales_order_id);

-- ───────────────────── RLS ─────────────────────
alter table tasks           enable row level security;
alter table time_categories enable row level security;
alter table time_entries    enable row level security;

-- tasks: cross-cutting work items — any org member may read/create/complete.
drop policy if exists tasks_org on tasks;
create policy tasks_org on tasks for all
  using (org_id in (select member_orgs())) with check (org_id in (select member_orgs()));

-- time_categories: reference data. Read by any member (needed to log time);
-- managed (write) by admins — reuses can_write('settings').
drop policy if exists time_categories_read on time_categories;
drop policy if exists time_categories_write on time_categories;
create policy time_categories_read on time_categories for select using (org_id in (select member_orgs()));
create policy time_categories_write on time_categories for all
  using (org_id in (select member_orgs()) and can_write('settings'))
  with check (org_id in (select member_orgs()) and can_write('settings'));

-- time_entries: gated by timeTracking; invoicers may also read/write to bill time.
drop policy if exists time_entries_read on time_entries;
drop policy if exists time_entries_write on time_entries;
create policy time_entries_read on time_entries for select
  using (org_id in (select member_orgs()) and (can_read('timeTracking') or can_read('invoices')));
create policy time_entries_write on time_entries for all
  using (org_id in (select member_orgs()) and (can_write('timeTracking') or can_write('invoices')))
  with check (org_id in (select member_orgs()) and (can_write('timeTracking') or can_write('invoices')));

-- Sales orders + their line items become visible/editable to the 'jobs' area too
-- (progress tracking), on top of 'salesOrders'. Row-level: a jobs user can edit
-- SO lines via API; the Jobs UI only exposes the ready toggle. Trusted-staff
-- tradeoff to avoid a separate progress table.
drop policy if exists sales_orders_read on sales_orders;
drop policy if exists sales_orders_write on sales_orders;
create policy sales_orders_read on sales_orders for select
  using (org_id in (select member_orgs()) and (can_read('salesOrders') or can_read('jobs')));
create policy sales_orders_write on sales_orders for all
  using (org_id in (select member_orgs()) and (can_write('salesOrders') or can_write('jobs')))
  with check (org_id in (select member_orgs()) and (can_write('salesOrders') or can_write('jobs')));

drop policy if exists sales_order_line_items_read on sales_order_line_items;
drop policy if exists sales_order_line_items_write on sales_order_line_items;
create policy sales_order_line_items_read on sales_order_line_items for select
  using (org_id in (select member_orgs()) and (can_read('salesOrders') or can_read('jobs')));
create policy sales_order_line_items_write on sales_order_line_items for all
  using (org_id in (select member_orgs()) and (can_write('salesOrders') or can_write('jobs')))
  with check (org_id in (select member_orgs()) and (can_write('salesOrders') or can_write('jobs')));
