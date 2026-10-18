-- A contact's preferred prefix (Mr. / Ms. / Mrs. / none), printed before the
-- name wherever the customer is addressed — the proposal's Attn and greeting,
-- the invoice's Bill To.
alter table contact_people add column if not exists prefix text not null default '';

-- Names typed with the title in them ("Mr. Steve Stojanovski") split into
-- prefix and name, so the title isn't printed twice.
update contact_people
   set prefix = initcap(substring(lower(name) from '^(mrs|mr|ms|dr)\.?\s')) || '.',
       name = trim(regexp_replace(name, '^(mrs|mr|ms|dr)\.?\s+', '', 'i'))
 where prefix = '' and name ~* '^(mrs|mr|ms|dr)\.?\s';
