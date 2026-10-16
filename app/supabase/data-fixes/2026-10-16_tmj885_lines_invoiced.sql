-- TMJ885 (job 7724): four milestone lines came over from Sage flagged closed
-- rather than invoiced, and the order was never marked invoiced, so Sales
-- Orders kept offering Invoice… on a job that is fully billed and paid.
-- Link each line to the Sage invoice that billed it (same amount, in date
-- order) and mark the order invoiced.
with so as (select id from sales_orders where number = 'TMJ885'),
pairs(sort, inv) as (values (0, 'VG260415-09'), (1, 'VG260425-04'), (2, 'VG260701-03'), (3, 'VG260721-01'))
update sales_order_line_items li
   set invoiced = true, closed = false, ready = false, invoice_id = i.id
  from pairs p, invoices i, so
 where li.sales_order_id = so.id and li.sort = p.sort and i.number = p.inv
   and i.sales_order_id = so.id and not li.invoiced;

update sales_orders set status = 'invoiced',
       invoice_id = (select id from invoices where number = 'VG260823-01')
 where number = 'TMJ885' and status = 'open';

-- Check: every line invoiced, the order invoiced. Fails the transaction otherwise.
do $$ begin
  if exists (select 1 from sales_order_line_items li join sales_orders so on so.id = li.sales_order_id
              where so.number = 'TMJ885' and not li.invoiced)
     or not exists (select 1 from sales_orders where number = 'TMJ885' and status = 'invoiced')
  then raise exception 'TMJ885 fix did not land as expected'; end if;
end $$;
