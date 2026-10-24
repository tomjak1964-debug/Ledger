-- Fixture proposals with no hardware design or material invoice PO Receipt (on
-- receipt of the PO) / Start-Up Complete / Final Documentation. Update the saved
-- Software & Start-Up package's schedule to that, and mark the Turnkey
-- package's Contract Award as billed on receipt of the PO. Proposals already
-- written keep their own schedules.
update settings set data = jsonb_set(data, '{fixturePackages}', (
  select jsonb_agg(case
    when p->>'id' = 'software' then jsonb_set(p, '{phases}', '[{"key":"po","label":"PO Receipt","pct":10,"onPo":true},{"key":"startup","label":"Start-Up Complete","pct":80},{"key":"docs","label":"Final Documentation","pct":10}]'::jsonb)
    when p->>'id' = 'turnkey' then jsonb_set(p, '{phases}', (select jsonb_agg(case when ph->>'key' = 'award' then ph || '{"onPo":true}'::jsonb else ph end) from jsonb_array_elements(p->'phases') ph))
    else p end)
  from jsonb_array_elements(data->'fixturePackages') p))
where data ? 'fixturePackages';
