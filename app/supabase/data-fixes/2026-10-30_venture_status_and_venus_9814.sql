-- Venture status sheet (2026-10-23) + Venus Controls invoice 9814 (2026-10-26).
--
-- 1. BILL-0076 (Venus 9814, $59,801.00) itemized as the invoice reads, each
--    panel a Control Panel cost of its own job (migration 041 lines):
--      4784 Panel  $19,887.00 → TMJ907    4775 Panel  $19,954.00 → TMJ906
--      4799 Panel  $19,960.00 → TMJ910
-- 2. Billing milestones now complete, marked ready to invoice:
--      TMJ917 (4756F1) Engineering Complete — sheet: Design Complete ✓
--      TMJ906 (4775), TMJ907 (4784), TMJ910 (4799) Panel Build Complete —
--      the panels Venus built and delivered on 10/26 (the 10/23 sheet predates it).
-- Every statement checks it touches exactly what it expects, or the whole fix rolls back.
do $$
declare n int;
begin
  update bills b set
    lines = jsonb_build_array(
      jsonb_build_object('id', gen_random_uuid(), 'desc', '4784 Panel', 'qty', 1, 'unitPrice', 19887.00, 'amount', 19887.00, 'account', '', 'salesOrderId', (select id from sales_orders where number = 'TMJ907'), 'costCategory', 'panel'),
      jsonb_build_object('id', gen_random_uuid(), 'desc', '4775 Panel', 'qty', 1, 'unitPrice', 19954.00, 'amount', 19954.00, 'account', '', 'salesOrderId', (select id from sales_orders where number = 'TMJ906'), 'costCategory', 'panel'),
      jsonb_build_object('id', gen_random_uuid(), 'desc', '4799 Panel', 'qty', 1, 'unitPrice', 19960.00, 'amount', 19960.00, 'account', '', 'salesOrderId', (select id from sales_orders where number = 'TMJ910'), 'costCategory', 'panel')),
    sales_order_id = null, cost_category = ''
  from contacts c
  where c.id = b.vendor_id and c.name ilike 'venus%' and b.number = 'BILL-0076' and b.ref = '9814'
    and b.amount = 59801.00 and b.lines = '[]'::jsonb;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'BILL-0076: expected 1 row, got %', n; end if;

  update sales_order_line_items li set ready = true
  from sales_orders so
  where so.id = li.sales_order_id and not li.invoiced and not li.closed and not li.ready and (
       (so.number = 'TMJ917' and li.description = '4756F1 Engineering Complete')
    or (so.number = 'TMJ906' and li.description = '4775 Panel Build Complete')
    or (so.number = 'TMJ907' and li.description = '4784 Panel Build Complete')
    or (so.number = 'TMJ910' and li.description = '4799 Panel Build Complete'));
  get diagnostics n = row_count;
  if n <> 4 then raise exception 'ready lines: expected 4, got %', n; end if;
end $$;
