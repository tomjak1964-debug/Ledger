-- Migration 022 — vendor tax id. Run ONCE (safe to re-run).
--
-- A vendor's Tax ID (EIN or SSN) is what the 1099 vendor report will be
-- keyed on. It is entered on the vendor in Vendors & Purchases → Vendors and
-- nowhere else. Text, not a number: it keeps its dashes and any leading zero.

alter table contacts add column if not exists tax_id text not null default '';
