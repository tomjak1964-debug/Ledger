-- Migration 023 — three more fixture rate categories. Run ONCE (safe to re-run).
--
-- torque_rate and io_link_rate are per-unit adders on the engineering /
-- start-up line, priced the way camera_rate is (rate x count on the proposal).
-- remote_sonic is a Remote Sonic Panel, a base-pricing line of its own like
-- remote_hmi. All three start at 0, and a 0 rate is left off the proposal.

alter table machine_types add column if not exists torque_rate  numeric(12,2) not null default 0;
alter table machine_types add column if not exists io_link_rate numeric(12,2) not null default 0;
alter table machine_types add column if not exists remote_sonic numeric(12,2) not null default 0;
