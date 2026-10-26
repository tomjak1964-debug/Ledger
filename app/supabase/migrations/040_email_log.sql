-- Every email sent through Ledger (the send-document function), as sent: who
-- sent it and from which address, to and cc, the kind of document, subject,
-- the files attached, the message, and whether the mail service took it.
-- Written only by send-document with the service role — no member can add,
-- change or delete a row — and read for the Correspondence report by anyone
-- with Reports access (owners and admins always).
create table if not exists email_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  sent_at timestamptz not null default now(),
  sent_by uuid,
  sent_by_email text not null default '',
  sent_by_name text not null default '',
  from_addr text not null default '',
  reply_to text not null default '',
  to_addrs text[] not null default '{}',
  cc_addrs text[] not null default '{}',
  doc_type text not null default '',
  subject text not null default '',
  attachments text[] not null default '{}',
  body text not null default '',
  status text not null default 'sent',
  error text not null default '',
  provider_id text not null default ''
);
create index if not exists email_log_org_sent on email_log (org_id, sent_at desc);
alter table email_log enable row level security;
drop policy if exists email_log_read on email_log;
create policy email_log_read on email_log for select
  using (org_id in (select member_orgs()) and can_read('reports'));
grant select on email_log to authenticated;
