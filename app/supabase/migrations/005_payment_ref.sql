-- Migration 005 — check number / reference on payments (for check printing).
alter table payments add column if not exists ref text not null default '';
