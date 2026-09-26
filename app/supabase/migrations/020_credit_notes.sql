-- Credit notes as their own document.
--
-- A credit note lives in `invoices` (it is an A/R document, ages and applies
-- like one) but carries kind='credit', its own number series, and prints as a
-- CREDIT MEMO. Its line items are stored negative, which is what every
-- existing balance/aging/apply calculation already understands.
--
-- Backfill: anything whose lines already sum negative was a credit typed as a
-- negative invoice, which is exactly what this replaces.
alter table invoices add column if not exists kind text not null default 'invoice';
alter table invoices drop constraint if exists invoices_kind_check;
alter table invoices add constraint invoices_kind_check check (kind in ('invoice', 'credit'));

update invoices i set kind = 'credit'
 where i.kind = 'invoice'
   and coalesce((select sum(l.qty * l.unit_price) from invoice_line_items l where l.invoice_id = i.id), 0) < 0;
