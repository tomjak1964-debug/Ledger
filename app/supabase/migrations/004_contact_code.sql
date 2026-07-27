-- Migration 004 — customer short codes for invoice numbering
-- (e.g. code VG → invoices numbered VG260728-01, -02… per day). Safe to re-run.
alter table contacts add column if not exists code text not null default '';
