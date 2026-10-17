-- Accountant / tax preparer fees (Hantz), apart from legal fees. Refuses to run twice.
insert into accounts (org_id, number, name, type, active, sort)
select o.org_id, '6565', 'Accounting & Tax Preparation', 'Expenses', true,
       coalesce((select sort from accounts a where a.org_id = o.org_id and a.number = '6560'), 0)
  from (select distinct org_id from accounts) o
 where not exists (select 1 from accounts a where a.org_id = o.org_id and a.number = '6565');
do $$ begin
  if (select count(*) from accounts where number = '6565') <> 1 then raise exception 'account not added as expected'; end if;
end $$;
