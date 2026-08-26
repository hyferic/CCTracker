begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select is(
  (select count(*) from public.card_catalog_current
    where product_stable_key in (
      'hilton-honors-aspire', 'marriott-bonvoy-brilliant', 'united-explorer',
      'southwest-rapid-rewards-priority', 'delta-skymiles-reserve'
    )),
  15::bigint,
  'the expanded catalog exposes all new product template rows through the current view'
);

select is(
  (select count(*) from public.card_catalog_current
    where template_stable_key in (
      'hilton-aspire-free-night', 'marriott-brilliant-free-night',
      'united-explorer-club-passes', 'united-explorer-hotels',
      'southwest-priority-anniversary-points',
      'delta-reserve-companion-certificate'
    ) and date_strategy = 'account_anniversary'),
  6::bigint,
  'renewal benefits are explicitly marked as account-anniversary benefits'
);

select is(
  (select count(*) from public.card_catalog_current
    where template_stable_key in (
      'hilton-aspire-resort-credit', 'hilton-aspire-flight-credit',
      'marriott-brilliant-dining', 'marriott-brilliant-elite-nights',
      'united-explorer-rideshare',
      'united-explorer-instacart', 'southwest-priority-companion-boost',
      'delta-reserve-resy', 'delta-reserve-rideshare'
    ) and date_strategy = 'calendar'),
  9::bigint,
  'calendar benefits are explicitly marked as calendar-bound benefits'
);

create temporary table renewal_context (
  key text primary key,
  value uuid,
  result jsonb
);
grant all on renewal_context to authenticated, service_role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

insert into renewal_context(key, value, result)
select 'inferred', (result->>'account_id')::uuid, result
from public.create_account_with_templates(
  jsonb_build_object(
    'display_name', 'Renewal inference test',
    'issuer', 'American Express',
    'card_service_name', 'Hilton Honors Aspire',
    'annual_fee', 550,
    'annual_fee_currency', 'USD',
    'renewal_date', '2026-08-15',
    'active', true
  ),
  '10000000-0000-4000-8000-00000000000d'::uuid,
  jsonb_build_array(jsonb_build_object(
    'template_version_id', '20000000-0000-4000-8000-00000000002b'
  )),
  false
) result;

insert into renewal_context(key, value, result)
select 'explicit', (result->>'account_id')::uuid, result
from public.create_account_with_templates(
  jsonb_build_object(
    'display_name', 'Explicit anniversary test',
    'issuer', 'American Express',
    'card_service_name', 'Hilton Honors Aspire',
    'annual_fee', 550,
    'annual_fee_currency', 'USD',
    'renewal_date', '2026-08-15',
    'benefit_anniversary_date', '2026-09-10',
    'active', true
  ),
  '10000000-0000-4000-8000-00000000000d'::uuid,
  jsonb_build_array(jsonb_build_object(
    'template_version_id', '20000000-0000-4000-8000-00000000002b'
  )),
  false
) result;

select throws_ok($sql$
  select public.create_account_with_templates(
    jsonb_build_object(
      'display_name', 'Missing anniversary test',
      'issuer', 'American Express',
      'card_service_name', 'Hilton Honors Aspire',
      'annual_fee', 550,
      'annual_fee_currency', 'USD',
      'active', true
    ),
    '10000000-0000-4000-8000-00000000000d'::uuid,
    jsonb_build_array(jsonb_build_object(
      'template_version_id', '20000000-0000-4000-8000-00000000002b'
    )),
    false
  )
$sql$, '22023', 'benefit_anniversary_date is required for selected anniversary benefits',
  'an anniversary benefit still requires a date when neither renewal nor benefit anniversary is supplied'
);

reset role;

select is(
  (select benefit_anniversary_date from public.accounts
    where id = (select value from renewal_context where key = 'inferred')),
  '2026-08-15'::date,
  'missing benefit anniversary is automatically inferred from renewal_date'
);

select is(
  (select (result->>'benefit_anniversary_inferred')::boolean
    from renewal_context where key = 'inferred'),
  true,
  'the provisioning response reports an inferred anniversary date'
);

select is(
  (select r.anchor_date from public.benefit_definition_revisions r
    join public.benefit_definitions d on d.id = r.definition_id
    join public.accounts a on a.id = d.account_id
    where a.id = (select value from renewal_context where key = 'inferred')
      and r.valid_to is null),
  '2026-08-15'::date,
  'the generated anniversary benefit uses the inferred account date as its recurrence anchor'
);

select is(
  (select benefit_anniversary_date from public.accounts
    where id = (select value from renewal_context where key = 'explicit')),
  '2026-09-10'::date,
  'an explicitly supplied benefit anniversary overrides renewal_date'
);

select * from extensions.finish();
rollback;
