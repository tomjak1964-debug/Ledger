-- Migration 012 — time approval. Run ONCE after 011. Idempotent.
--
-- Logged time must be approved before it can be billed onto an invoice. New
-- entries start unapproved; existing time is grandfathered as approved so
-- nothing already logged suddenly becomes unbillable.

alter table time_entries add column if not exists approved    boolean not null default false;
alter table time_entries add column if not exists approved_by text not null default '';

update time_entries set approved = true where approved = false;  -- grandfather existing
