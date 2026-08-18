-- Migration 007 — role-based access control (Phase 2, feature 7).
-- Run ONCE in the Supabase SQL editor. Safe to re-run (idempotent guards).
--
-- Model: every org member has a role ('owner' | 'admin' | 'member') and a
-- `permissions` map (area → 'read' | 'write'). Owners/admins get write on
-- everything. Access is enforced in the DATABASE here (not just the UI): each
-- table's single "org" policy is split into a read policy and a write policy
-- gated by the member's permission for that area.
--
-- Reference data (settings, contacts, catalog, machine rates) stays readable by
-- every member — the quote/invoice editors need customer names, catalog items,
-- tax rate, etc. — but is only writable by members with that area's write right.
-- Transactional data (quotes, orders, invoices, bills, expenses, proposals,
-- payments) is gated on BOTH read and write.

-- ───────────────────── columns + role values ─────────────────────
alter table org_members add column if not exists permissions jsonb not null default '{}'::jsonb;
alter table org_members drop constraint if exists org_members_role_check;
alter table org_members add constraint org_members_role_check check (role in ('owner','admin','member'));

-- ───────────────────── permission helpers ─────────────────────
-- Resolved level for the signed-in user in their default org. Admins/owners
-- always 'write'. SECURITY DEFINER so it can read org_members without tripping
-- that table's own RLS (no recursion).
create or replace function my_perm(p_area text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when coalesce(bool_or(role in ('owner','admin')), false) then 'write'
    else coalesce(max(permissions->>p_area), 'none')
  end
  from org_members
  where user_id = auth.uid() and org_id = default_org()
$$;

create or replace function can_read(p_area text) returns boolean
language sql stable security definer set search_path = public as
$$ select my_perm(p_area) in ('read','write') $$;

create or replace function can_write(p_area text) returns boolean
language sql stable security definer set search_path = public as
$$ select my_perm(p_area) = 'write' $$;

create or replace function is_org_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists(select 1 from org_members
     where org_id = p_org and user_id = auth.uid() and role in ('owner','admin')) $$;

-- ───────────────────── org_members management (owner + admins) ─────────────────────
drop policy if exists org_members_owner_all on org_members;
drop policy if exists org_members_manage on org_members;
create policy org_members_manage on org_members for all
  using (is_org_admin(org_id)) with check (is_org_admin(org_id));
-- (org_members_sel from migration 003 still lets members read their own org roster.)

-- ───────────────────── reference tables: read = any member, write = area ─────────────────────
do $$
declare r record;
begin
  for r in select * from (values
      ('settings','settings'), ('contacts','contacts'), ('contact_people','contacts'),
      ('catalog_items','catalog'), ('machine_types','proposals')
    ) as t(tbl, area)
  loop
    execute format('drop policy if exists %I on %I', r.tbl || '_org', r.tbl);
    execute format('drop policy if exists %I on %I', r.tbl || '_read', r.tbl);
    execute format('drop policy if exists %I on %I', r.tbl || '_write', r.tbl);
    execute format('create policy %I on %I for select using (org_id in (select member_orgs()))',
                   r.tbl || '_read', r.tbl);
    execute format('create policy %I on %I for all using (org_id in (select member_orgs()) and can_write(%L)) with check (org_id in (select member_orgs()) and can_write(%L))',
                   r.tbl || '_write', r.tbl, r.area, r.area);
  end loop;
end $$;

-- ───────────────────── transactional tables: read + write both gated ─────────────────────
do $$
declare r record;
begin
  for r in select * from (values
      ('quotes','quotes'), ('quote_line_items','quotes'),
      ('sales_orders','salesOrders'), ('sales_order_line_items','salesOrders'),
      ('invoices','invoices'), ('invoice_line_items','invoices'),
      ('bills','payables'), ('expenses','expenses'), ('proposals','proposals')
    ) as t(tbl, area)
  loop
    execute format('drop policy if exists %I on %I', r.tbl || '_org', r.tbl);
    execute format('drop policy if exists %I on %I', r.tbl || '_read', r.tbl);
    execute format('drop policy if exists %I on %I', r.tbl || '_write', r.tbl);
    execute format('create policy %I on %I for select using (org_id in (select member_orgs()) and can_read(%L))',
                   r.tbl || '_read', r.tbl, r.area);
    execute format('create policy %I on %I for all using (org_id in (select member_orgs()) and can_write(%L)) with check (org_id in (select member_orgs()) and can_write(%L))',
                   r.tbl || '_write', r.tbl, r.area, r.area);
  end loop;
end $$;

-- ───────────────────── payments: routed by parent (invoice → receivables/invoices, bill → payables) ─────────────────────
drop policy if exists payments_org on payments;
drop policy if exists payments_read on payments;
drop policy if exists payments_write on payments;
create policy payments_read on payments for select using (
  org_id in (select member_orgs()) and (
    (parent_type = 'invoice' and (can_read('invoices') or can_read('receivables'))) or
    (parent_type = 'bill' and can_read('payables'))
  ));
create policy payments_write on payments for all using (
  org_id in (select member_orgs()) and (
    (parent_type = 'invoice' and (can_write('invoices') or can_write('receivables'))) or
    (parent_type = 'bill' and can_write('payables'))
  )) with check (
  org_id in (select member_orgs()) and (
    (parent_type = 'invoice' and (can_write('invoices') or can_write('receivables'))) or
    (parent_type = 'bill' and can_write('payables'))
  ));

-- ───────────────────── audit log: read = settings, insert = any member (logging never blocks) ─────────────────────
drop policy if exists audit_log_org on audit_log;
drop policy if exists audit_log_read on audit_log;
drop policy if exists audit_log_write on audit_log;
create policy audit_log_read on audit_log for select using (org_id in (select member_orgs()) and can_read('settings'));
create policy audit_log_write on audit_log for insert with check (org_id in (select member_orgs()));

-- org_sequences keeps its migration-003 org-wide policy: any member who can
-- write a document is allowed to claim its next number.
