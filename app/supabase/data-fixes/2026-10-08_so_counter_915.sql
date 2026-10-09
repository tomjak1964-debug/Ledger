-- Sales orders created in Ledger continue the Sage series: TMJ915 next.
-- The 'so' sequence stood at 902 (and the app formatted it TMJ-0902); the
-- highest order on file is TMJ914. Refuses to run if the sequence isn't where
-- it was, or if any order numbered TMJ915 or above already exists.
do $$
declare cur int; clash int;
begin
  select next_value into cur from org_sequences where doc_type = 'so';
  if cur is distinct from 902 then raise exception 'so sequence is %, expected 902', cur; end if;
  select count(*) into clash from sales_orders where number ~ '^TMJ-?0*9(1[5-9]|[2-9][0-9])$' or number ~ '^TMJ-?0*[1-9][0-9]{3,}$';
  if clash > 0 then raise exception '% sales order(s) already numbered TMJ915 or above', clash; end if;
  update org_sequences set next_value = 915 where doc_type = 'so';
end $$;
