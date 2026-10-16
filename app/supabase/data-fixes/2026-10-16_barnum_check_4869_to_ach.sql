-- Pay Bills run 2026-10-16: H.H. Barnum bill 26411195 ($91.06) was left on the
-- dialog's default method and recorded as check #4869, though the run was ACH.
-- Move it onto the same transfer as the vendor's other two bills (E261016-02);
-- check #4869 goes back on the shelf.
update payments p set method = 'ACH / Wire', ref = 'E261016-02'
  from bills b, contacts c
 where p.parent_id = b.id and p.parent_type = 'bill' and b.vendor_id = c.id
   and c.name = 'H.H. Barnum Company' and b.ref = '26411195'
   and p.method = 'Check' and p.ref = '4869' and p.date = '2026-10-16' and p.amount = 91.06;

do $$ begin
  if exists (select 1 from payments where parent_type = 'bill' and method = 'Check' and ref = '4869')
     or (select count(*) from payments where parent_type = 'bill' and ref = 'E261016-02' and date = '2026-10-16') <> 3
  then raise exception 'Barnum fix did not land as expected'; end if;
end $$;
