-- Fixture Rates, Engineering section: a flat Hardware Design amount and a
-- per-HMI adder, both rolled into the proposal's Engineering/Start-Up line.
-- Zero on every existing fixture type, so no proposal's price moves.
alter table machine_types add column if not exists hardware_design numeric(12,2) not null default 0;
alter table machine_types add column if not exists hmi_rate numeric(12,2) not null default 0;
