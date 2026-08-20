-- Migration 009 — job costing (profitability per sales order).
-- Run ONCE in the Supabase SQL editor, after 008. Idempotent guards.
--
-- Adds the cost side to the money the app already tracks: a cost rate on time
-- categories (vs the bill rate), a cost snapshot on each time entry, and an
-- optional job (sales_order_id) link on expenses and bills so materials can be
-- attributed to a job. Revenue (invoiced) − labor cost − materials = margin.

alter table time_categories add column if not exists cost_rate numeric(12,2) not null default 0;
alter table time_entries    add column if not exists cost      numeric(12,2) not null default 0;

alter table expenses add column if not exists sales_order_id uuid references sales_orders(id) on delete set null;
alter table bills    add column if not exists sales_order_id uuid references sales_orders(id) on delete set null;
create index if not exists expenses_so_idx on expenses(sales_order_id);
create index if not exists bills_so_idx on bills(sales_order_id);

-- No RLS changes: these are columns on existing tables, already covered by
-- their table policies (expenses → 'expenses', bills → 'payables',
-- time_* → 'timeTracking'/'invoices').
