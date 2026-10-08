-- TMJ880 and TMJ881 came over from Sage as one line each ("Sales order TMJ88x
-- (imported from Sage)"); the orders were invoiced and paid in full through
-- invoices that don't point back at the line, so the line still read "not
-- invoiced" in Job Tracking. Starting data: close the line. Status flag only —
-- no amount, invoice or payment changes, and the orders stay 'invoiced'.
-- Refuses to run unless it touches exactly these two lines.
do $$
declare n int;
begin
  update sales_order_line_items li set closed = true, ready = false
    from sales_orders so
   where so.id = li.sales_order_id
     and so.number in ('TMJ880', 'TMJ881')
     and li.description like 'Sales order TMJ88_ (imported from Sage)'
     and li.invoiced = false and li.closed = false;
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'expected to close 2 lines, would close %', n; end if;
end $$;
