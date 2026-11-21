-- 2026-11-20 — Venture status sheet 11/20/26 shows 4769 Design Complete; its SO (TMJ937) was
-- logged after the earlier fix, so mark its Engineering Complete milestone ready. One line only.
do $$
declare n int;
begin
  update sales_order_line_items li set ready = true
  from sales_orders so
  where li.sales_order_id = so.id
    and not li.invoiced and not li.closed and not li.ready
    and so.number = 'TMJ937' and li.description = '4769RL Engineering Complete';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'expected 1 line, got % — rolled back', n; end if;
end $$;
