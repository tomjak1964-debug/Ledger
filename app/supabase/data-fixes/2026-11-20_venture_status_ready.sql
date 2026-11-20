-- 2026-11-20 — Venture "2026 Control Status 11/20/26" sheet (NAS Claude/Ledger/Venture Status 20261120.xlsx):
-- mark ready the SO milestone lines the sheet shows complete and the books haven't invoiced yet.
--   Design Complete -> Engineering Complete · Panel Complete -> Panel Build Complete
--   Wiring Complete -> Field Wiring Complete · asbuilt -> Final Documentation
-- Matched by SO number and line text; only open lines (not invoiced, closed or ready) change.
-- TMJ922 is job 984 but its lines read "2097 …"; the sheet's 2097 row (wiring + asbuilt done)
-- matches those lines, so they're the ones ticked.
do $$
declare n int;
begin
  update sales_order_line_items li set ready = true
  from sales_orders so
  where li.sales_order_id = so.id
    and not li.invoiced and not li.closed and not li.ready
    and (so.number, li.description) in (
      ('TMJ884', '4724-F3 Final Documentation'),
      ('TMJ922', '2097 Field Wiring Complete'),
      ('TMJ922', '2097 Final Documentation'),
      ('TMJ903', '4766 Panel Build Complete'),
      ('TMJ904', '4768 Panel Build Complete'),
      ('TMJ926', '4780 Panel Build Complete'),
      ('TMJ934', '4782F Panel Build Complete'),
      ('TMJ928', '4793 Panel Build Complete'),
      ('TMJ930', '4798 Panel Build Complete'),
      ('TMJ911', '4801 Panel Build Complete'));
  get diagnostics n = row_count;
  if n <> 10 then raise exception 'expected 10 lines, got % — rolled back', n; end if;
end $$;
