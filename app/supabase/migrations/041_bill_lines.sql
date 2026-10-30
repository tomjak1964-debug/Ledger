-- Vendor bills itemized like the vendor's invoice: each line its own
-- description, quantity × price, expense account, and the job (sales order)
-- and cost category it is a cost of. jsonb on the row, like journal entries:
--   [{ id, desc, qty, unitPrice, amount, account, salesOrderId, costCategory }]
-- The bill's amount stays the sum of its lines, so payments, aging and the
-- registers read it as before. An empty list is a one-line bill (amount,
-- expense_account, sales_order_id and cost_category on the row, as before).
alter table bills add column if not exists lines jsonb not null default '[]'::jsonb;

-- A locked bill's lines are locked with its money.
drop trigger if exists lock_bills on bills;
create trigger lock_bills before insert or update or delete on bills
  for each row execute function guard_locked_period('date', 'amount', 'vendor_id', 'expense_account', 'lines');
