-- Migration 006 — partial invoicing + deletion audit log.
-- Run ONCE in the Supabase SQL editor. Safe to re-run (idempotent guards).
--
-- Part 1: sales-order line items gain per-line invoiced tracking, so an SO can
--   be billed in phases — some lines invoiced now, the rest left open. The SO
--   only flips to 'invoiced' once every line has been billed.
-- Part 2: audit_log records deletions (who / what / when) for accountability.

-- ───────────────────── part 1: per-line invoiced tracking ─────────────────────
alter table sales_order_line_items add column if not exists invoiced   boolean not null default false;
alter table sales_order_line_items add column if not exists invoice_id  uuid;
create index if not exists so_line_items_invoice_idx on sales_order_line_items(invoice_id);

-- ───────────────────── part 2: deletion audit log ─────────────────────
create table if not exists audit_log (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid default default_org(),
  user_id       uuid default auth.uid(),
  user_email    text not null default '',
  action        text not null,               -- 'delete'
  entity_type   text not null,               -- 'invoice' | 'sales_order' | 'bill' | 'quote' | …
  entity_number text not null default '',
  detail        text not null default '',
  created_at    timestamptz not null default now()
);
create index if not exists audit_log_org_idx on audit_log(org_id);

alter table audit_log enable row level security;
drop policy if exists audit_log_org on audit_log;
create policy audit_log_org on audit_log for all
  using (org_id in (select member_orgs()))
  with check (org_id in (select member_orgs()));
