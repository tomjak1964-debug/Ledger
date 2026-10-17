-- ADP's payroll service fees, next to the payroll accounts. Refuses to run twice.
insert into accounts (org_id, number, name, type, active, sort)
select o.org_id, '6110', 'Payroll Service Fees', 'Expenses', true,
       coalesce((select sort from accounts a where a.org_id = o.org_id and a.number = '6100'), 0)
  from (select distinct org_id from accounts) o
 where not exists (select 1 from accounts a where a.org_id = o.org_id and a.number = '6110');
do $$ begin
  if (select count(*) from accounts where number = '6110') <> 1 then raise exception 'account not added as expected'; end if;
end $$;
