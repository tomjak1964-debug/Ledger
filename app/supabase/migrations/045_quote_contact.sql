-- Migration 045 — a quote is addressed to a person, as a proposal is (016, 034).
-- contact_name is what the Contact / Attn box says (prefilled with the customer's
-- proposals contact, anything may be typed); contact_person_id is the contact it
-- matched, for their email. Additive only: blank reads as the proposals contact.
alter table quotes add column if not exists contact_name      text not null default '';
alter table quotes add column if not exists contact_person_id uuid;
