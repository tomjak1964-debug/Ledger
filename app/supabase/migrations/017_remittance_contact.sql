-- Migration 017 — remittance contact on vendors. Run ONCE (safe to re-run).
--
-- A vendor's A/P contact is often not the same person as the sales contact, so
-- remittances get their own name / phone / email / address. The email is the
-- default recipient when emailing a remittance advice.

alter table contacts add column if not exists remit_name    text not null default '';
alter table contacts add column if not exists remit_phone   text not null default '';
alter table contacts add column if not exists remit_email   text not null default '';
alter table contacts add column if not exists remit_address text not null default '';
