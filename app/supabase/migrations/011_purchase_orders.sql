-- Migration 011 — vendor purchase orders. Run ONCE after 010. Idempotent.
--
-- POs you issue to suppliers, optionally tied to a job (sales order) so the
-- parts flow into job costing, and matchable to a vendor bill. Gated by the
-- same 'payables' access area (procurement lives with the spend side).

create table if not exists purchase_orders (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid default default_org(),
  number         text not null,
  vendor_id      uuid,
  date           date,
  expected_date  date,
  status         text not null default 'open' check (status in ('open','received','closed','cancelled')),
  tax_rate       numeric(12,2) not null default 0,
  notes          text not null default '',
  sales_order_id uuid,                    -- optional job link
  created_at     timestamptz not null default now()
);
create index if not exists purchase_orders_org_idx on purchase_orders(org_id);

create table if not exists purchase_order_line_items (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid default default_org(),
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  description       text not null default '',
  qty               numeric(12,3) not null default 0,
  unit              text not null default '',
  unit_price        numeric(12,2) not null default 0,
  sort              int not null default 0,
  created_at        timestamptz not null default now()
);

alter table bills add column if not exists purchase_order_id uuid;

-- RLS: read + write both gated by the 'payables' area.
alter table purchase_orders           enable row level security;
alter table purchase_order_line_items enable row level security;
do $$
declare t text;
begin
  foreach t in array array['purchase_orders','purchase_order_line_items'] loop
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format('create policy %I on %I for select using (org_id in (select member_orgs()) and can_read(''payables''))', t || '_read', t);
    execute format('create policy %I on %I for all using (org_id in (select member_orgs()) and can_write(''payables'')) with check (org_id in (select member_orgs()) and can_write(''payables''))', t || '_write', t);
  end loop;
end $$;
