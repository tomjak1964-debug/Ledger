-- Recurring invoices and bills: a template copied from a document, how often it
-- repeats, and the next date it's due. Nothing runs on its own — the Invoices and
-- Payables pages list what's due and create it on a click (calc/recurring.js).
--   template jsonb: invoice { customerId, contactPersonId, poNumber, taxRate, notes,
--                     incomeAccount, lineItems: [{ desc, qty, unit, unitPrice }] }
--                   bill    { vendorId, expenseAccount, notes,
--                     lines: [{ desc, qty, unitPrice, account, salesOrderId, costCategory }] }
create table if not exists recurring (
  id uuid primary key default gen_random_uuid(),
  org_id uuid default default_org(),
  kind text not null check (kind in ('invoice', 'bill')),
  name text not null default '',
  party_id uuid,
  every text not null default 'month' check (every in ('week', 'month', 'quarter', 'year')),
  next_date date not null,
  end_date date,
  active boolean not null default true,
  template jsonb not null default '{}'::jsonb,
  last_doc_id uuid,
  last_run date,
  created_at timestamptz not null default now()
);
create index if not exists recurring_org_idx on recurring (org_id, kind, next_date);
alter table recurring enable row level security;
drop policy if exists recurring_read on recurring;
drop policy if exists recurring_write on recurring;
create policy recurring_read on recurring for select
  using (org_id in (select member_orgs()) and ((kind = 'invoice' and can_read('invoices')) or (kind = 'bill' and can_read('payables'))));
create policy recurring_write on recurring for all
  using (org_id in (select member_orgs()) and ((kind = 'invoice' and can_write('invoices')) or (kind = 'bill' and can_write('payables'))))
  with check (org_id in (select member_orgs()) and ((kind = 'invoice' and can_write('invoices')) or (kind = 'bill' and can_write('payables'))));
grant select, insert, update, delete on recurring to authenticated;
