-- Migration 003 — shared company books (multi-user) + machine-proposal domain.
-- Run ONCE in the Supabase SQL editor. Safe to re-run (idempotent guards).
--
-- Part 1: org model. Every business row gets org_id; RLS switches from
--   "my rows" to "my organization's rows". Existing data is adopted into an
--   org owned by its current user. Invite teammates by email in Settings.
-- Part 2: proposal domain — contact_people, machine_types (costing rates),
--   proposals, invoices.proposal_id.

-- ───────────────────── part 1: orgs ─────────────────────
create table if not exists orgs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default 'My Company',
  owner_id   uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists org_members (
  org_id     uuid not null references orgs(id) on delete cascade,
  user_id    uuid,                     -- null until the invitee signs in
  email      text not null,
  role       text not null default 'member' check (role in ('owner','member')),
  created_at timestamptz not null default now(),
  primary key (org_id, email)
);
create index if not exists org_members_user_idx on org_members(user_id);

create or replace function member_orgs() returns setof uuid
language sql stable security definer set search_path = public as
$$ select org_id from org_members where user_id = auth.uid() $$;

create or replace function default_org() returns uuid
language sql stable security definer set search_path = public as
$$ select org_id from org_members where user_id = auth.uid()
   order by created_at limit 1 $$;

-- invited-by-email members get linked to their auth user on first load
create or replace function claim_membership() returns void
language sql security definer set search_path = public as
$$ update org_members set user_id = auth.uid()
   where user_id is null
     and lower(email) = lower(coalesce(auth.jwt()->>'email','')) $$;

-- brand-new signups (not invited anywhere) get their own org
create or replace function bootstrap_org(p_name text default 'My Company') returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select org_id into v from org_members where user_id = auth.uid() limit 1;
  if v is not null then return v; end if;
  insert into orgs (name, owner_id)
    values (coalesce(nullif(p_name,''),'My Company'), auth.uid()) returning id into v;
  insert into org_members (org_id, user_id, email, role)
    values (v, auth.uid(), coalesce(auth.jwt()->>'email', auth.uid()::text), 'owner');
  return v;
end $$;

-- org_id on every business table (default = your org, so app inserts don't change)
alter table settings      add column if not exists org_id uuid unique;
alter table contacts      add column if not exists org_id uuid default default_org();
alter table catalog_items add column if not exists org_id uuid default default_org();
alter table quotes        add column if not exists org_id uuid default default_org();
alter table quote_line_items        add column if not exists org_id uuid default default_org();
alter table sales_orders  add column if not exists org_id uuid default default_org();
alter table sales_order_line_items  add column if not exists org_id uuid default default_org();
alter table invoices      add column if not exists org_id uuid default default_org();
alter table invoice_line_items      add column if not exists org_id uuid default default_org();
alter table payments      add column if not exists org_id uuid default default_org();
alter table bills         add column if not exists org_id uuid default default_org();
alter table expenses      add column if not exists org_id uuid default default_org();

-- per-org document counters (replaces per-user sequences)
create table if not exists org_sequences (
  org_id     uuid not null references orgs(id) on delete cascade,
  doc_type   text not null,
  next_value int  not null default 1,
  primary key (org_id, doc_type)
);

-- adopt existing per-user data into an org (one org per existing settings row)
do $$
declare u record; new_org uuid;
begin
  for u in
    select s.user_id,
           coalesce(nullif(s.data->>'company',''),'My Company') as cname,
           (select email from auth.users where id = s.user_id)  as uemail
    from settings s
    where s.org_id is null
  loop
    insert into orgs (name, owner_id) values (u.cname, u.user_id) returning id into new_org;
    insert into org_members (org_id, user_id, email, role)
      values (new_org, u.user_id, coalesce(u.uemail, u.user_id::text), 'owner')
      on conflict do nothing;
    update settings      set org_id = new_org where user_id = u.user_id;
    update contacts      set org_id = new_org where user_id = u.user_id;
    update catalog_items set org_id = new_org where user_id = u.user_id;
    update quotes        set org_id = new_org where user_id = u.user_id;
    update quote_line_items       set org_id = new_org where user_id = u.user_id;
    update sales_orders  set org_id = new_org where user_id = u.user_id;
    update sales_order_line_items set org_id = new_org where user_id = u.user_id;
    update invoices      set org_id = new_org where user_id = u.user_id;
    update invoice_line_items     set org_id = new_org where user_id = u.user_id;
    update payments      set org_id = new_org where user_id = u.user_id;
    update bills         set org_id = new_org where user_id = u.user_id;
    update expenses      set org_id = new_org where user_id = u.user_id;
    insert into org_sequences (org_id, doc_type, next_value)
      select new_org, doc_type, next_value from sequences where user_id = u.user_id
      on conflict do nothing;
  end loop;
end $$;

alter table settings alter column org_id set default default_org();

-- counters now claim per-org
create or replace function next_doc_number(p_doc_type text)
returns int language sql as
$$
  insert into org_sequences (org_id, doc_type, next_value)
  values (default_org(), p_doc_type, 2)
  on conflict (org_id, doc_type)
  do update set next_value = org_sequences.next_value + 1
  returning next_value - 1;
$$;

-- ───────────────────── part 2: proposal domain ─────────────────────
create table if not exists contact_people (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid default default_org(),
  contact_id uuid not null references contacts(id) on delete cascade,
  name       text not null default '',
  title      text not null default '',
  email      text not null default '',
  phone      text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists contact_people_contact_idx on contact_people(contact_id);

-- the in-app version of TMJ Costing.xlsx — all rates editable
create table if not exists machine_types (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid default default_org(),
  name         text not null default '',
  eng_base     numeric(12,2) not null default 0,  -- engineering/start-up base
  camera_rate  numeric(12,2) not null default 0,  -- per camera adder
  panel_budget numeric(12,2) not null default 0,
  io_first     numeric(12,2) not null default 0,  -- 1st I/O block
  io_addl      numeric(12,2) not null default 0,  -- each additional block
  dn_checkout  numeric(12,2) not null default 0,  -- Data National checkout
  dn_material  numeric(12,2) not null default 0,
  field_wiring numeric(12,2) not null default 0,
  runoff       numeric(12,2) not null default 0,
  remote_hmi   numeric(12,2) not null default 0,
  sort         int not null default 0,
  created_at   timestamptz not null default now()
);

create table if not exists proposals (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid default default_org(),
  number            text not null,
  customer_id       uuid,
  contact_person_id uuid,
  date              date,
  status            text not null default 'draft'
                    check (status in ('draft','submitted','won','lost')),
  job_number        text not null default '',
  description       text not null default '',
  location          text not null default '',
  machine_type_id   uuid,
  specs             jsonb not null default '{}'::jsonb,  -- counts: nests, generators, welds, pp, clamps, clips, tabs, shuttle, platen, cameras, dataNational, ioBlocks
  pricing           jsonb not null default '{}'::jsonb,  -- snapshot: lines + totals at last save
  phases            jsonb not null default '[]'::jsonb,  -- [{key,label,pct,invoiceId?}]
  notes             text not null default '',
  po_number         text not null default '',
  sales_order_id    uuid,
  created_at        timestamptz not null default now()
);
create index if not exists proposals_org_idx on proposals(org_id);

alter table invoices add column if not exists proposal_id uuid;
alter table invoices add column if not exists contact_person_id uuid;

-- ───────────────────── RLS: org-membership everywhere ─────────────────────
alter table orgs           enable row level security;
alter table org_members    enable row level security;
alter table org_sequences  enable row level security;
alter table contact_people enable row level security;
alter table machine_types  enable row level security;
alter table proposals      enable row level security;

drop policy if exists orgs_member_sel on orgs;
create policy orgs_member_sel on orgs for select using (id in (select member_orgs()));
drop policy if exists orgs_owner_upd on orgs;
create policy orgs_owner_upd on orgs for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists org_members_sel on org_members;
create policy org_members_sel on org_members for select using (org_id in (select member_orgs()));
drop policy if exists org_members_owner_all on org_members;
create policy org_members_owner_all on org_members for all
  using    (exists (select 1 from orgs o where o.id = org_members.org_id and o.owner_id = auth.uid()))
  with check (exists (select 1 from orgs o where o.id = org_members.org_id and o.owner_id = auth.uid()));

do $$
declare t text;
begin
  foreach t in array array[
    'settings','contacts','catalog_items','quotes','quote_line_items',
    'sales_orders','sales_order_line_items','invoices','invoice_line_items',
    'payments','bills','expenses',
    'org_sequences','contact_people','machine_types','proposals']
  loop
    execute format('drop policy if exists %I on %I', t || '_own', t);
    execute format('drop policy if exists %I on %I', t || '_org', t);
    execute format(
      'create policy %I on %I for all using (org_id in (select member_orgs())) with check (org_id in (select member_orgs()))',
      t || '_org', t);
  end loop;
end $$;

-- old per-user sequences table is superseded
drop table if exists sequences;
