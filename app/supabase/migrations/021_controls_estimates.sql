-- Proposals of two kinds, with revisions.
--
-- 'machine' is the Venture Global proposal as it has always been: content
-- counts priced off the machine-type rate card. 'controls' is the general
-- job estimate for any customer: standard engineering components (hardware
-- design, drafting, PLC, HMI, start-up) as hours x rate, with hardware
-- optional. Both live in this table; specs/pricing/phases are jsonb and take
-- either shape.
--
-- A re-quote is a new revision of the same number: the old row is marked
-- 'superseded' and keeps everything it had, the new row carries rev + 1.
alter table proposals add column if not exists kind text not null default 'machine';
alter table proposals drop constraint if exists proposals_kind_check;
alter table proposals add constraint proposals_kind_check check (kind in ('machine', 'controls'));

alter table proposals add column if not exists rev int not null default 0;

alter table proposals drop constraint if exists proposals_status_check;
alter table proposals add constraint proposals_status_check
  check (status in ('draft', 'submitted', 'won', 'lost', 'superseded'));
