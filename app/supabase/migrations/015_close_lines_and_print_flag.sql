-- Migration 015 — close SO line items without billing; track invoice printing.
-- Run ONCE after 013. Idempotent.
--
-- 'closed' lets you retire a sales-order line you won't bill (cancelled scope)
-- so it clears from "to invoice" without an invoice. 'printed' tracks whether
-- an invoice has been printed yet, so you can find the ones you still owe.

alter table sales_order_line_items add column if not exists closed  boolean not null default false;
alter table invoices                add column if not exists printed boolean not null default false;
