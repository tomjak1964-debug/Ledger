-- Migration 014 — mobile Field module (Phase A of the partner app).
-- Run ONCE after 013 (order among 014/015 doesn't matter). Idempotent.
--
-- Adds customer site coordinates (for geo-fencing) and grants the new 'field'
-- access area write/read on the tech-facing tables, so a field tech can be
-- given just Field access: log time, log expenses, and update job progress.

alter table contacts add column if not exists lat numeric(9,6);
alter table contacts add column if not exists lng numeric(9,6);

-- time_entries: timeTracking OR invoices OR field
drop policy if exists time_entries_read on time_entries;
drop policy if exists time_entries_write on time_entries;
create policy time_entries_read on time_entries for select
  using (org_id in (select member_orgs()) and (can_read('timeTracking') or can_read('invoices') or can_read('field')));
create policy time_entries_write on time_entries for all
  using (org_id in (select member_orgs()) and (can_write('timeTracking') or can_write('invoices') or can_write('field')))
  with check (org_id in (select member_orgs()) and (can_write('timeTracking') or can_write('invoices') or can_write('field')));

-- expenses: expenses OR field
drop policy if exists expenses_read on expenses;
drop policy if exists expenses_write on expenses;
create policy expenses_read on expenses for select
  using (org_id in (select member_orgs()) and (can_read('expenses') or can_read('field')));
create policy expenses_write on expenses for all
  using (org_id in (select member_orgs()) and (can_write('expenses') or can_write('field')))
  with check (org_id in (select member_orgs()) and (can_write('expenses') or can_write('field')));

-- sales_orders + lines: salesOrders OR jobs OR field
do $$
declare t text;
begin
  foreach t in array array['sales_orders','sales_order_line_items'] loop
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format('create policy %I on %I for select using (org_id in (select member_orgs()) and (can_read(''salesOrders'') or can_read(''jobs'') or can_read(''field'')))', t || '_read', t);
    execute format('create policy %I on %I for all using (org_id in (select member_orgs()) and (can_write(''salesOrders'') or can_write(''jobs'') or can_write(''field''))) with check (org_id in (select member_orgs()) and (can_write(''salesOrders'') or can_write(''jobs'') or can_write(''field'')))', t || '_write', t);
  end loop;
end $$;
