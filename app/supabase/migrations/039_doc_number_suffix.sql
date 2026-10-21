-- Every proposal and invoice number carries the day's sequence: PROP-VG261021-01,
-- INV-VG261021-01 (Rev 1.61). A device still running an older copy of the app
-- could save the first one of a day without it ("PROP-VG261021"); the database
-- now adds the lowest free -NN itself. And when that older copy saves the same
-- document again — still holding the number without the suffix — the suffixed
-- number already on file is kept. A number typed by hand that isn't in the
-- PROP-/INV-…YYMMDD shape is left alone.
create or replace function suffix_doc_number() returns trigger
language plpgsql as $$
declare n int; candidate text; pat text;
begin
  pat := case tg_table_name when 'proposals' then '^PROP-[A-Za-z0-9]*[0-9]{6}$' else '^INV-[A-Za-z0-9]*[0-9]{6}$' end;
  if new.number is null or new.number !~ pat then return new; end if;
  -- A document keeping the number it already has is left as it is (three
  -- invoices issued without a suffix before Rev 1.61 stay as issued).
  if tg_op = 'UPDATE' and new.number = old.number then return new; end if;
  -- Re-saved by an older copy: keep the suffixed number the row already has.
  if tg_op = 'UPDATE' and old.number ~ ('^' || new.number || '-[0-9]{2}$') then
    new.number := old.number; return new;
  end if;
  for n in 1..99 loop
    candidate := new.number || '-' || lpad(n::text, 2, '0');
    if tg_table_name = 'proposals' then
      exit when not exists (select 1 from proposals p where p.org_id is not distinct from new.org_id and p.number = candidate and p.id <> new.id);
    else
      exit when not exists (select 1 from invoices i where i.org_id is not distinct from new.org_id and i.number = candidate and i.id <> new.id);
    end if;
  end loop;
  new.number := candidate;
  return new;
end $$;

drop trigger if exists proposals_number_suffix on proposals;
create trigger proposals_number_suffix before insert or update of number on proposals
  for each row execute function suffix_doc_number();
drop trigger if exists invoices_number_suffix on invoices;
create trigger invoices_number_suffix before insert or update of number on invoices
  for each row execute function suffix_doc_number();
