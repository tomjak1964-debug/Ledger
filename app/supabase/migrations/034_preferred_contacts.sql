-- Contacts: one list of people per customer / vendor, and which of them gets
-- the invoices, the proposals and the remittances. The single "contact person"
-- field on the company goes from the screen; this moves each one into the
-- people list so nobody is lost.
--
-- The preferences are plain uuids, not foreign keys: a backup import inserts
-- companies before their people, and the app reads a preference that names a
-- person no longer on file as "none" (the company email then stands in).
alter table contacts add column if not exists pref_invoice_person uuid;
alter table contacts add column if not exists pref_proposal_person uuid;
alter table contacts add column if not exists pref_remit_person uuid;

-- The old contact person becomes a person, unless one of that company's people
-- already carries the name ("Mr. Steve Stojanovski" covers "Steve Stojanovski").
insert into contact_people (org_id, contact_id, name, title, email, phone)
select c.org_id, c.id, trim(c.contact), '', '', ''
  from contacts c
 where coalesce(trim(c.contact), '') <> ''
   and not exists (select 1 from contact_people p where p.contact_id = c.id
                    and lower(p.name) like '%' || lower(trim(c.contact)) || '%');

-- A customer's invoices and proposals went to that person before (proposals
-- started on them; the company email carried the invoices), so they stay the
-- preferred contact for both. Vendors get no remittance preference: their
-- contact is usually the salesperson, and remittances keep going to the
-- company email until someone is picked.
update contacts c set
  pref_invoice_person = coalesce(c.pref_invoice_person, p.id),
  pref_proposal_person = coalesce(c.pref_proposal_person, p.id)
  from contact_people p
 where c.type = 'customer' and coalesce(trim(c.contact), '') <> ''
   and p.contact_id = c.id and lower(p.name) like '%' || lower(trim(c.contact)) || '%';

-- A vendor that had a remittance contact typed in gets it as a person, marked
-- preferred for remittances.
insert into contact_people (org_id, contact_id, name, title, email, phone)
select c.org_id, c.id, coalesce(nullif(trim(c.remit_name), ''), 'Accounts Receivable'), 'Remittances', trim(c.remit_email), trim(c.remit_phone)
  from contacts c
 where c.type = 'vendor' and (coalesce(trim(c.remit_name), '') <> '' or coalesce(trim(c.remit_email), '') <> '')
   and c.pref_remit_person is null;
update contacts c set pref_remit_person = p.id
  from contact_people p
 where c.type = 'vendor' and c.pref_remit_person is null and p.contact_id = c.id and p.title = 'Remittances'
   and (coalesce(trim(c.remit_name), '') <> '' or coalesce(trim(c.remit_email), '') <> '');
