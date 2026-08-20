-- Migration 010 — file attachments (receipts, signed POs, drawings).
-- Run ONCE in the Supabase SQL editor, after 009. Idempotent guards.
--
-- Files live in a PRIVATE Storage bucket 'attachments'; a metadata row records
-- what each file is attached to. Both the bucket objects and the metadata are
-- scoped to the org. Object paths start with the org id: {org_id}/{type}/{id}/{file}.
--
-- If your SQL role can't insert into storage.buckets / create storage policies,
-- create a PRIVATE bucket named "attachments" in Dashboard → Storage instead,
-- then run just the "attachments" table section below.

-- ───────────────────── metadata table ─────────────────────
create table if not exists attachments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid default default_org(),
  parent_type  text not null,               -- 'invoice' | 'bill' | 'expense' | 'sales_order'
  parent_id    uuid not null,
  path         text not null,               -- storage object path
  filename     text not null default '',
  size         bigint not null default 0,
  content_type text not null default '',
  uploaded_by  text not null default '',
  created_at   timestamptz not null default now()
);
create index if not exists attachments_parent_idx on attachments(parent_id);
create index if not exists attachments_org_idx on attachments(org_id);

alter table attachments enable row level security;
drop policy if exists attachments_org on attachments;
create policy attachments_org on attachments for all
  using (org_id in (select member_orgs())) with check (org_id in (select member_orgs()));

-- ───────────────────── storage bucket + policies ─────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 26214400)   -- 25 MB per file
on conflict (id) do nothing;

-- Org members may read/add/remove objects whose first path segment is one of
-- their org ids. (storage.objects already has RLS enabled by Supabase.)
drop policy if exists attach_read on storage.objects;
drop policy if exists attach_insert on storage.objects;
drop policy if exists attach_delete on storage.objects;
create policy attach_read on storage.objects for select
  using (bucket_id = 'attachments' and nullif((storage.foldername(name))[1],'')::uuid in (select public.member_orgs()));
create policy attach_insert on storage.objects for insert
  with check (bucket_id = 'attachments' and nullif((storage.foldername(name))[1],'')::uuid in (select public.member_orgs()));
create policy attach_delete on storage.objects for delete
  using (bucket_id = 'attachments' and nullif((storage.foldername(name))[1],'')::uuid in (select public.member_orgs()));
