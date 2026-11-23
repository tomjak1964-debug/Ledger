-- Migration 044 — a quote reads like a proposal: it names the job and what it is.
-- Additive only: blank by default, so older code reads past them. Converting a
-- quote to a sales order carries both onto the SO (its job_number / description).
alter table quotes add column if not exists job_number  text not null default '';
alter table quotes add column if not exists description text not null default '';
