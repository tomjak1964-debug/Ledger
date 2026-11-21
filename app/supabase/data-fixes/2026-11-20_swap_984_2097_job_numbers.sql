-- 2026-11-20 — 984 / 2097 were entered with each other's PO; Tom renamed the SO lines (after the
-- Contract Award invoices) to match the PO numbers. Swap the job number and description to match:
--   TMJ922 (PO 2097F-0000-001)  984 / B PILLAR      -> 2097 / WD COWL LH/RH
--   TMJ931 (PO 984F-0000-001)   2097 / WD COWL LH/RH -> 984 / B PILLAR
-- Description follows the job (status sheet: 984 = WD B PILLAR, 2097 = WD COWL LH/RH). Specs and budget are identical.
do $$
declare n int;
begin
  update sales_orders set job_number = '2097', description = 'WD COWL LH/RH'
   where number = 'TMJ922' and job_number = '984' and po_number = '2097F-0000-001' and description = 'B PILLAR';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'TMJ922: expected 1 row, got % — rolled back', n; end if;
  update sales_orders set job_number = '984', description = 'B PILLAR'
   where number = 'TMJ931' and job_number = '2097' and po_number = '984F-0000-001' and description = 'WD COWL LH/RH';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'TMJ931: expected 1 row, got % — rolled back', n; end if;
end $$;
