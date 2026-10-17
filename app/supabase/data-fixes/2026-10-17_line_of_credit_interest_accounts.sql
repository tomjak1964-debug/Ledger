-- Two accounts the books need for the line of credit (draws, payments) and
-- the interest on it and on the cards. Refuses to run twice.
insert into accounts (org_id, number, name, type, active, sort)
select o.org_id, v.number, v.name, v.type, true, v.sort
  from (select distinct org_id from accounts) o,
       (values ('2600', 'Line of Credit', 'Other Current Liabilities', 19),
               ('7150', 'Interest Expense', 'Expenses', 64)) as v(number, name, type, sort)
 where not exists (select 1 from accounts a where a.org_id = o.org_id and a.number = v.number);
do $$ begin
  if (select count(*) from accounts where number in ('2600', '7150')) <> 2 then raise exception 'accounts not added as expected'; end if;
end $$;
