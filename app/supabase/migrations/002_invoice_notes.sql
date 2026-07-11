-- Migration 002 — per-invoice notes (printed on the invoice, falls back to the
-- default in Settings). Run in the Supabase SQL editor if you created your
-- database before this column existed. Safe to re-run.
alter table invoices add column if not exists notes text not null default '';
