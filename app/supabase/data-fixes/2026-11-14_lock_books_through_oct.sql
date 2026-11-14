-- Lock the books through 2026-10-31 (Settings → Accounts → Books locked through): checking reconciled
-- through Oct 31, the Citi and Amex statements posted through October. Migration 030's triggers then
-- refuse money changes on anything dated on or before it; payments dated after it are fine.
do $$
declare n int;
begin
  update settings set data = jsonb_set(data, '{accounts,lockDate}', '"2026-10-31"')
  where coalesce(data->'accounts'->>'lockDate', '') = '';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'settings: expected 1 row, got %', n; end if;
end $$;
