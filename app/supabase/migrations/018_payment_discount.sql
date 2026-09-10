-- Discount taken on a payment.
--
-- A discount settles part of a document without cash moving: an early-payment
-- term taken on a vendor bill, or one a customer took on an invoice. The
-- payments table is shared by both sides, so one column covers A/P and A/R.
--
-- `amount` stays cash — every cash figure in the app reads it. A document is
-- closed by amount + discount (see settled() in src/calc/ledger.js), so an
-- $980 payment with a $20 discount settles a $1,000 bill.
alter table payments add column if not exists discount numeric(12,2) not null default 0;
