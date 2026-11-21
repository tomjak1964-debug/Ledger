-- 2026-11-20 — TMJ914 is job 4756 but its milestone lines were typed "4763 …" (4763 is TMJ901).
-- Rename the five SO lines to "4756 …". Invoice INV261008-01 keeps its own line text as sent.
do $$
declare n int;
begin
  update sales_order_line_items li set description = regexp_replace(li.description, '^4763 ', '4756 ')
  from sales_orders so
  where li.sales_order_id = so.id and so.number = 'TMJ914' and so.job_number = '4756'
    and li.description like '4763 %';
  get diagnostics n = row_count;
  if n <> 5 then raise exception 'expected 5 lines, got % — rolled back', n; end if;
end $$;
