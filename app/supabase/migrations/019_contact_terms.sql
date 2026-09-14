-- Payment terms belong to the customer or vendor, not to the company.
--
-- terms is nullable on purpose: null means "use the company default" from
-- Settings, so nothing changes for a contact you never touch. The discount
-- pair is the early-payment term — 2% if paid within 10 days is
-- discount_pct 2, discount_days 10, printed as "2/10 Net 30".
alter table contacts add column if not exists terms          int;
alter table contacts add column if not exists discount_pct   numeric(6,3) not null default 0;
alter table contacts add column if not exists discount_days  int          not null default 0;
