-- Migration 033 — inactive customers and vendors. Run ONCE after 032 (safe to re-run).
-- Additive only. A contact that's no longer used can be marked inactive instead
-- of deleted: its history stays, it still reports, but it's left out of every
-- pick list (a document already naming it keeps showing it).
alter table contacts add column if not exists active boolean not null default true;
