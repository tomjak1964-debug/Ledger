-- The company's banking details (account and routing numbers) for the
-- customer banking sheet, kept out of the settings row — which every member
-- can read — in a table of their own. Only an owner / admin, or a member with
-- the Banking permission, can read them; changing them needs Banking write.
create table if not exists bank_info (
  org_id uuid primary key default default_org() references orgs(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table bank_info enable row level security;
drop policy if exists bank_info_read on bank_info;
create policy bank_info_read on bank_info for select
  using (org_id in (select member_orgs()) and can_read('banking'));
drop policy if exists bank_info_write on bank_info;
create policy bank_info_write on bank_info for all
  using (org_id in (select member_orgs()) and can_write('banking'))
  with check (org_id in (select member_orgs()) and can_write('banking'));
grant select, insert, update, delete on bank_info to authenticated;
