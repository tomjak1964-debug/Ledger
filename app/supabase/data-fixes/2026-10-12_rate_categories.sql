-- One place for rates: Settings → Time Categories. The labor rate card's
-- tasks are now priced from categories, so the three it had that no category
-- covered become categories, at the card's rates. Cost rates start at 0 for
-- the owner to fill in. Adds only what's missing (by name).
insert into time_categories (org_id, name, rate, cost_rate, active, sort)
select o.id, v.name, v.rate, 0, true, v.sort
  from orgs o, (values ('Project Management', 100.00, 3), ('Documentation', 60.00, 4), ('Production / Stand-By Support', 80.00, 5)) as v(name, rate, sort)
 where not exists (select 1 from time_categories t where t.org_id = o.id and lower(t.name) = lower(v.name));
