-- Migration 016 — free-text contact/attention name on proposals. Run ONCE.
--
-- Proposals can now carry any contact name (typed or picked), instead of only
-- a link to a structured contact-person record.

alter table proposals add column if not exists contact_name text not null default '';
