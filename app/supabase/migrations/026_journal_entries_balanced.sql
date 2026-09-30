-- Migration 026 — the database refuses an unbalanced journal entry. Run ONCE
-- after 025 (safe to re-run).
--
-- The app already refuses to save one (saveJournalEntry in src/lib/store.js
-- and the editor's Save button), but a ledger rule belongs in the ledger: a
-- row written any other way — the SQL editor, an import — must balance too.
-- Debits and credits over the jsonb lines must agree to the cent and there
-- must be at least two lines, or the insert / update is rejected with the
-- reason, which the app shows on the toast.

create or replace function journal_entry_balanced() returns trigger
language plpgsql as $$
declare
  d numeric; c numeric; n int;
begin
  select coalesce(sum((l->>'debit')::numeric), 0), coalesce(sum((l->>'credit')::numeric), 0), count(*)
    into d, c, n
  from jsonb_array_elements(coalesce(new.lines, '[]'::jsonb)) l;
  if n < 2 then
    raise exception 'A journal entry needs at least two lines.';
  end if;
  if abs(d - c) > 0.005 then
    raise exception 'Journal entry % is out of balance: debits % against credits %.', coalesce(nullif(new.number, ''), '(new)'), d, c;
  end if;
  return new;
end $$;

drop trigger if exists journal_entries_balanced on journal_entries;
create trigger journal_entries_balanced
  before insert or update on journal_entries
  for each row execute function journal_entry_balanced();
