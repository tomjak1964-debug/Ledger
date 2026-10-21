-- A member's own business email (e.g. jakuszanek@tmjengineering.com): what an
-- email they send "as me" comes from, with replies to it. It has to be on the
-- company's mail domain — the send-document function refuses any other.
alter table org_members add column if not exists send_as text not null default '';
