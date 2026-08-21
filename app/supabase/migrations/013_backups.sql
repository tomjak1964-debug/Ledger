-- Migration 013 — storage bucket for automated backups. Run ONCE after 012.
--
-- The scheduled-backup edge function writes JSON dumps here (service role, so
-- it bypasses RLS on write). Org members may read their own org's backups.
-- Backup on/off, email vs storage, and recipient live in settings.data.backup
-- (no table needed). If your SQL role can't touch storage, create a PRIVATE
-- bucket named "backups" in Dashboard → Storage instead.

insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do nothing;

drop policy if exists backups_read on storage.objects;
create policy backups_read on storage.objects for select
  using (bucket_id = 'backups' and nullif((storage.foldername(name))[1],'')::uuid in (select public.member_orgs()));
