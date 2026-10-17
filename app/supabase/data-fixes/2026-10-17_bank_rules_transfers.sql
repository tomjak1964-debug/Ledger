-- Bank reconciliation remembers how a recurring line was posted
-- (settings.bankRules, keyed by bankKey() in calc/bankRecon.js). Seed the two
-- transfers Tom identified: XXXXX1064 is his personal checking (an owner
-- contribution, 3920 Paid-in Capital); the transfer from the line of credit is
-- a draw (2600 Line of Credit). Leaves any rule already there alone.
update settings set data = jsonb_set(data, '{bankRules}',
  coalesce(data->'bankRules', '{}'::jsonb)
  || jsonb_build_object(
       'ONLINE TRANSFER FROM XXXXX1064', jsonb_build_object('action','post','account','3920','recordAs','journal','payee','Owner contribution','vendorId','','billAccount','','customerId','','invAccount',''),
       'ONLINE TRANSFER FROM', jsonb_build_object('action','post','account','2600','recordAs','journal','payee','Line of credit draw','vendorId','','billAccount','','customerId','','invAccount',''))
  - (select coalesce(array_agg(k), '{}') from jsonb_object_keys(coalesce(data->'bankRules','{}'::jsonb)) k)
  || coalesce(data->'bankRules', '{}'::jsonb), true);
select jsonb_pretty(data->'bankRules') from settings;
