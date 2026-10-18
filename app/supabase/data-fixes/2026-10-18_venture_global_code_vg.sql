-- Venture Global's customer code, so its invoices and proposals number as
-- INV-VG261018 / PROP-VG261018. Only if it has none.
update contacts set code = 'VG' where type = 'customer' and name = 'Venture Global Engineering' and coalesce(code, '') = '';
do $$ begin
  if (select count(*) from contacts where type = 'customer' and name = 'Venture Global Engineering' and code = 'VG') <> 1 then raise exception 'not set as expected'; end if;
end $$;
