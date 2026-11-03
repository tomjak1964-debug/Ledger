-- Michigan business filing fees (MI BUSINESS FILINGS, $125 on 2026-06-04 and 2026-07-12,
-- Costco Citi card) from 6650 Commissions and Fees to 6250 Other Taxes Expense — the
-- "Taxes and licenses" line on the return. The card-statement lines move too, so the next
-- import suggests 6250 for this merchant. Amounts, dates and the card are unchanged.
do $$
declare n int;
begin
  update expenses set account = '6250'
  where id in ('90a58151-9025-4750-9aba-e4ecf6622639', 'f11c0d72-60b6-469c-80a0-51ffb303f87d')
    and vendor = 'MI BUSINESS FILINGS MICHIGANBUSINMI' and amount = 125 and account = '6650';
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'expenses: expected 2, got %', n; end if;

  update card_statements set lines = (
    select jsonb_agg(case when l->>'expenseId' in ('90a58151-9025-4750-9aba-e4ecf6622639', 'f11c0d72-60b6-469c-80a0-51ffb303f87d')
      then jsonb_set(l, '{account}', '"6250"') else l end order by ord)
    from jsonb_array_elements(lines) with ordinality as t(l, ord))
  where id in ('cd2cdaee-3c7a-4412-82a9-9c4253eeda14', '9ef9e2bf-6677-4a2b-8772-f5f3f773cad4');
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'card statements: expected 2, got %', n; end if;
end $$;
