-- Ledger — Supabase schema (quote-to-cash)
-- Normalized relational version of the legacy single-blob localStorage shape
-- (see CLAUDE.md §5/§11 at the repo root). Run this once in the Supabase SQL
-- editor (Dashboard → SQL → New query).
--
-- Design notes:
--  * Every table carries user_id (default auth.uid()) and RLS restricts all
--    access to the owning user — sign in from any device, see only your books.
--  * Line items are real rows (normalized) so future reporting (P&L, sales
--    tax) is plain SQL. The app reassembles them into the legacy in-memory
--    shape (app/src/lib/adapters.js) so the ported calc logic runs unchanged.
--  * Chain references (quotes.sales_order_id, sales_orders.invoice_id, etc.)
--    are intentionally plain uuid columns with NO foreign keys: the legacy app
--    allows deleting a quote while the SO it spawned lives on with a dangling
--    reference, and lookups render "—" for missing refs. FKs would change
--    those semantics. Line items DO cascade from their parent document.
--  * Document numbers come from next_doc_number(), which increments the
--    per-user sequence atomically — fixes the two-tabs counter collision noted
--    in CLAUDE.md §9.

-- ───────────────────────── extensions ─────────────────────────
create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ───────────────────────── tables ─────────────────────────────

-- One row per user; everything except counters lives in the jsonb blob
-- (company info, tax/terms defaults, prefixes, default notes).
create table if not exists settings (
  user_id     uuid primary key default auth.uid(),
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- Per-user document counters ("QUO-0007"). next_value is the NEXT number to
-- hand out. Claim numbers only via next_doc_number() below.
create table if not exists sequences (
  user_id     uuid not null default auth.uid(),
  doc_type    text not null check (doc_type in ('quote','so','invoice','bill')),
  next_value  int  not null default 1,
  primary key (user_id, doc_type)
);

create table if not exists contacts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid(),
  type        text not null check (type in ('customer','vendor')),
  name        text not null default '',
  contact     text not null default '',
  email       text not null default '',
  phone       text not null default '',
  address     text not null default '',   -- multiline, \n separated
  created_at  timestamptz not null default now()
);
create index if not exists contacts_user_idx on contacts(user_id);

create table if not exists catalog_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid(),
  description text not null default '',
  unit        text not null default '',
  unit_price  numeric(12,2) not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists catalog_items_user_idx on catalog_items(user_id);

create table if not exists quotes (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid(),
  number         text not null,
  customer_id    uuid,
  date           date,
  expiry_date    date,
  status         text not null default 'draft'
                 check (status in ('draft','sent','accepted','declined')),
  po_number      text not null default '',
  tax_rate       numeric(7,3) not null default 0,
  notes          text not null default '',
  sales_order_id uuid,                    -- set once converted (no FK, see top)
  created_at     timestamptz not null default now()
);
create index if not exists quotes_user_idx on quotes(user_id);

create table if not exists quote_line_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid(),
  quote_id    uuid not null references quotes(id) on delete cascade,
  description text not null default '',
  qty         numeric(12,3) not null default 0,
  unit        text not null default '',
  unit_price  numeric(12,2) not null default 0,
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists quote_line_items_quote_idx on quote_line_items(quote_id);

create table if not exists sales_orders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid(),
  number      text not null,
  quote_id    uuid,
  customer_id uuid,
  po_number   text not null default '',
  date        date,
  status      text not null default 'open' check (status in ('open','invoiced')),
  tax_rate    numeric(7,3) not null default 0,
  invoice_id  uuid,                       -- set once invoiced (no FK, see top)
  created_at  timestamptz not null default now()
);
create index if not exists sales_orders_user_idx on sales_orders(user_id);

create table if not exists sales_order_line_items (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid(),
  sales_order_id uuid not null references sales_orders(id) on delete cascade,
  description    text not null default '',
  qty            numeric(12,3) not null default 0,
  unit           text not null default '',
  unit_price     numeric(12,2) not null default 0,
  sort           int not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists sales_order_line_items_so_idx on sales_order_line_items(sales_order_id);

-- Invoice status (paid/overdue/partial/unpaid) is NEVER stored — it is derived
-- in the app from payments + due date, exactly like the legacy version.
create table if not exists invoices (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid(),
  number         text not null,
  sales_order_id uuid,
  quote_id       uuid,
  customer_id    uuid,
  po_number      text not null default '',
  date           date,
  due_date       date,
  tax_rate       numeric(7,3) not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists invoices_user_idx on invoices(user_id);

create table if not exists invoice_line_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid(),
  invoice_id  uuid not null references invoices(id) on delete cascade,
  description text not null default '',
  qty         numeric(12,3) not null default 0,
  unit        text not null default '',
  unit_price  numeric(12,2) not null default 0,
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists invoice_line_items_inv_idx on invoice_line_items(invoice_id);

-- Shared payments table for both invoices (A/R) and bills (A/P).
-- parent_id is a plain uuid (it can point at either table); the app deletes
-- payments when it deletes their parent document.
create table if not exists payments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid(),
  parent_type text not null check (parent_type in ('invoice','bill')),
  parent_id   uuid not null,
  amount      numeric(12,2) not null default 0,
  date        date,
  method      text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists payments_parent_idx on payments(parent_id);
create index if not exists payments_user_idx on payments(user_id);

create table if not exists bills (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid(),
  number      text not null,
  vendor_id   uuid,
  date        date,
  due_date    date,
  amount      numeric(12,2) not null default 0,  -- single amount, no line items
  ref         text not null default '',          -- vendor's invoice #
  notes       text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists bills_user_idx on bills(user_id);

create table if not exists expenses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid(),
  date        date,
  category    text not null default '',
  vendor      text not null default '',
  amount      numeric(12,2) not null default 0,
  method      text not null default '',
  notes       text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists expenses_user_idx on expenses(user_id);

-- ───────────────────────── row-level security ─────────────────
-- Same policy everywhere: you can only touch your own rows.

alter table settings               enable row level security;
alter table sequences              enable row level security;
alter table contacts               enable row level security;
alter table catalog_items          enable row level security;
alter table quotes                 enable row level security;
alter table quote_line_items       enable row level security;
alter table sales_orders           enable row level security;
alter table sales_order_line_items enable row level security;
alter table invoices               enable row level security;
alter table invoice_line_items     enable row level security;
alter table payments               enable row level security;
alter table bills                  enable row level security;
alter table expenses               enable row level security;

drop policy if exists settings_own               on settings;
drop policy if exists sequences_own              on sequences;
drop policy if exists contacts_own               on contacts;
drop policy if exists catalog_items_own          on catalog_items;
drop policy if exists quotes_own                 on quotes;
drop policy if exists quote_line_items_own       on quote_line_items;
drop policy if exists sales_orders_own           on sales_orders;
drop policy if exists sales_order_line_items_own on sales_order_line_items;
drop policy if exists invoices_own               on invoices;
drop policy if exists invoice_line_items_own     on invoice_line_items;
drop policy if exists payments_own               on payments;
drop policy if exists bills_own                  on bills;
drop policy if exists expenses_own               on expenses;

create policy settings_own               on settings               for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy sequences_own              on sequences              for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy contacts_own               on contacts               for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy catalog_items_own          on catalog_items          for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy quotes_own                 on quotes                 for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy quote_line_items_own       on quote_line_items       for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy sales_orders_own           on sales_orders           for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy sales_order_line_items_own on sales_order_line_items for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy invoices_own               on invoices               for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy invoice_line_items_own     on invoice_line_items     for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy payments_own               on payments               for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy bills_own                  on bills                  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy expenses_own               on expenses               for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ───────────────────────── functions ──────────────────────────
-- Atomically claim the next document number for the signed-in user.
-- Returns the claimed value (e.g. 7 → the app formats "QUO-0007") and bumps
-- the sequence in the same statement, so two devices can never get the same
-- number. Runs as the caller, so RLS on sequences still applies.
create or replace function next_doc_number(p_doc_type text)
returns int
language sql
as $$
  insert into sequences (user_id, doc_type, next_value)
  values (auth.uid(), p_doc_type, 2)
  on conflict (user_id, doc_type)
  do update set next_value = sequences.next_value + 1
  returning next_value - 1;
$$;
