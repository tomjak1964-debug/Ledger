-- TMJ915–917 (won 2026-10-23) each start with a Contract Award milestone billed
-- on receipt of the PO, but were created before such lines started out ready,
-- so no Create Invoice task went up. Mark those lines ready; the app raises the
-- task when it next loads (reload() reconciles job tasks both ways).
update sales_order_line_items li set ready = true
  from sales_orders so
 where li.sales_order_id = so.id and so.number in ('TMJ915', 'TMJ916', 'TMJ917') and so.status = 'open'
   and li.description ~* 'contract award' and not li.invoiced and not li.closed and not li.ready;
do $$ begin
  if (select count(*) from sales_order_line_items li join sales_orders so on so.id = li.sales_order_id
       where so.number in ('TMJ915','TMJ916','TMJ917') and li.description ~* 'contract award' and li.ready) <> 3
  then raise exception 'expected three Contract Award lines ready'; end if;
end $$;
