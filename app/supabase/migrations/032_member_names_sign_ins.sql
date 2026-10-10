-- Migration 032 — a name for each user, and when they last signed in. Run ONCE
-- after 031 (safe to re-run). Additive only.
--
-- Settings → Users & Access shows each teammate by name with a pill for their
-- last sign-in. The name is ours (org_members.name); the sign-in time lives in
-- the auth schema, which the app can't read, so member_sign_ins() hands an
-- admin of the company the times for that company's members only — anyone
-- else gets nothing.
alter table org_members add column if not exists name text not null default '';

create or replace function member_sign_ins(p_org uuid)
returns table (user_id uuid, last_sign_in_at timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select m.user_id, u.last_sign_in_at
    from org_members m join auth.users u on u.id = m.user_id
   where m.org_id = p_org and is_org_admin(p_org)
$$;
revoke all on function member_sign_ins(uuid) from public, anon;
grant execute on function member_sign_ins(uuid) to authenticated;
