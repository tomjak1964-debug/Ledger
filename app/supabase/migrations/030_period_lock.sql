-- Migration 030 — lock the books through a date. Run ONCE after 029 (safe to re-run).
--
-- Settings → Accounts → "Books locked through" (settings.data.accounts.lockDate,
-- YYYY-MM-DD, blank = no lock). With a lock set, the database refuses to add,
-- delete or change the money on anything dated on or before it — invoices and
-- their lines, bills, payments and receipts, expenses and journal entries — so
-- a reconciled month or a filed year can't move underneath you. Changes that
-- don't touch the books are still allowed on a locked document (marking an
-- invoice printed, its notes, due date, PO or number; a payment's reference).
-- The lock is enforced here rather than in the app, so it holds for every
-- device, every user and every data fix. To change something locked, move the
-- lock date back in Settings first.

create or replace function books_locked_through(p_org uuid) returns date
language sql stable security definer set search_path = public as $$
  select nullif(data->'accounts'->>'lockDate', '')::date from settings where org_id = p_org
$$;

-- The guard for a table with a date column. TG_ARGV names the columns that
-- carry money or posting; an update to a locked row that changes none of
-- them goes through.
create or replace function guard_locked_period() returns trigger
language plpgsql as $$
declare
  lock date := books_locked_through(coalesce(case when TG_OP = 'DELETE' then null else NEW.org_id end, case when TG_OP = 'INSERT' then null else OLD.org_id end));
  d_old date; d_new date; col text;
  msg text;
begin
  if lock is null then return case when TG_OP = 'DELETE' then OLD else NEW end; end if;
  msg := 'The books are locked through ' || to_char(lock, 'FMMon FMDD, YYYY')
      || '. Move the lock date in Settings → Accounts to change anything dated on or before it.';
  if TG_OP <> 'INSERT' then d_old := (to_jsonb(OLD)->>'date')::date; end if;
  if TG_OP <> 'DELETE' then d_new := (to_jsonb(NEW)->>'date')::date; end if;
  if TG_OP = 'INSERT' and d_new <= lock then raise exception using errcode = 'check_violation', message = msg; end if;
  if TG_OP = 'DELETE' and d_old <= lock then raise exception using errcode = 'check_violation', message = msg; end if;
  if TG_OP = 'UPDATE' and (d_old <= lock or d_new <= lock) then
    foreach col in array TG_ARGV loop
      if (to_jsonb(OLD)->col) is distinct from (to_jsonb(NEW)->col) then
        raise exception using errcode = 'check_violation', message = msg;
      end if;
    end loop;
  end if;
  return case when TG_OP = 'DELETE' then OLD else NEW end;
end $$;

-- Invoice lines carry no date of their own: they're locked with their invoice.
create or replace function guard_locked_invoice_lines() returns trigger
language plpgsql as $$
declare inv_id uuid := case when TG_OP = 'DELETE' then OLD.invoice_id else NEW.invoice_id end;
        d date; o uuid; lock date;
begin
  select date, org_id into d, o from invoices where id = inv_id;
  if TG_OP = 'UPDATE' and OLD.invoice_id is distinct from NEW.invoice_id and d is null then
    select date, org_id into d, o from invoices where id = OLD.invoice_id;
  end if;
  lock := books_locked_through(o);
  if lock is not null and d <= lock then
    raise exception using errcode = 'check_violation',
      message = 'The books are locked through ' || to_char(lock, 'FMMon FMDD, YYYY')
             || '. Move the lock date in Settings → Accounts to change anything dated on or before it.';
  end if;
  return case when TG_OP = 'DELETE' then OLD else NEW end;
end $$;

drop trigger if exists lock_invoices on invoices;
create trigger lock_invoices before insert or update or delete on invoices
  for each row execute function guard_locked_period('date', 'customer_id', 'tax_rate', 'kind', 'income_account');
drop trigger if exists lock_invoice_lines on invoice_line_items;
create trigger lock_invoice_lines before insert or update or delete on invoice_line_items
  for each row execute function guard_locked_invoice_lines();
drop trigger if exists lock_bills on bills;
create trigger lock_bills before insert or update or delete on bills
  for each row execute function guard_locked_period('date', 'amount', 'vendor_id', 'expense_account');
drop trigger if exists lock_payments on payments;
create trigger lock_payments before insert or update or delete on payments
  for each row execute function guard_locked_period('date', 'amount', 'discount', 'parent_id', 'parent_type', 'method', 'cash_account');
drop trigger if exists lock_expenses on expenses;
create trigger lock_expenses before insert or update or delete on expenses
  for each row execute function guard_locked_period('date', 'amount', 'account', 'cash_account', 'vendor');
drop trigger if exists lock_journal_entries on journal_entries;
create trigger lock_journal_entries before insert or update or delete on journal_entries
  for each row execute function guard_locked_period('date', 'lines');
