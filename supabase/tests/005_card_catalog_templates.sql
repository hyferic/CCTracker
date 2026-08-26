begin;

set local timezone = 'America/New_York';
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select has_view('public', 'card_catalog_current', 'narrow current catalog view exists');
select has_column('public', 'accounts', 'benefit_anniversary_date',
  'benefit anniversary is distinct from renewal date');
select has_column('public', 'benefit_definition_revisions', 'catalog_business_snapshot',
  'catalog metadata is captured in a stored revision snapshot');
select ok(has_table_privilege('authenticated', 'public.card_catalog_current', 'SELECT'),
  'authenticated users can read current catalog facts');
select ok(not has_table_privilege('anon', 'public.card_catalog_current', 'SELECT'),
  'anonymous users cannot read the catalog view');
select ok(not has_table_privilege('authenticated', 'private.card_catalog_product_versions', 'SELECT')
  and not has_table_privilege('authenticated', 'private.card_catalog_template_versions', 'SELECT'),
  'browser roles cannot read or mutate catalog base tables');
select is((select count(distinct product_version_id) from public.card_catalog_current),
  17::bigint, 'the current catalog exposes exactly the 17 approved products');
select is((select count(*) from public.card_catalog_current),
  54::bigint, 'the current catalog exposes exactly the 54 approved templates');
select ok(has_function_privilege('authenticated',
  'public.create_account_with_templates(jsonb,uuid,jsonb,boolean)', 'EXECUTE'),
  'authenticated users can call the atomic bundle RPC');
select ok(not has_function_privilege('anon',
  'public.create_account_with_templates(jsonb,uuid,jsonb,boolean)', 'EXECUTE'),
  'anonymous users cannot call the bundle RPC');
select is((select count(*) from public.card_catalog_current where template_stable_key like '%saks%'),
  0::bigint, 'retired Saks is absent from current provisioning');
select is((select count(*) from public.card_catalog_current where template_stable_key = 'amex-platinum-oura'),
  1::bigint, 'current Oura benefit is present');
select is((select count(*) from public.card_catalog_current where template_stable_key like 'chase-csr-doordash-nonrestaurant-%'),
  2::bigint, 'DoorDash non-restaurant coupons remain independent templates');

select throws_ok(
  $$select public.import_backup('{}'::jsonb, 'import_as_new', 'suppress_current')$$,
  '22023', 'backup schema_version is required',
  'a missing backup schema_version is rejected explicitly');
select throws_ok(
  $$select public.import_backup('{"schema_version":null}'::jsonb, 'import_as_new', 'suppress_current')$$,
  '22023', 'backup schema_version is required',
  'a null backup schema_version is rejected explicitly');

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

create temporary table catalog_test_context (key text primary key, value uuid);
grant all on catalog_test_context to authenticated, service_role;

with created as (
  select public.create_account_with_templates(
    '{"display_name":"Template Platinum","issuer":"American Express","card_service_name":"Platinum Card","annual_fee":895,"annual_fee_currency":"USD","renewal_date":"2026-02-01","benefit_anniversary_date":"2026-03-15","active":true}'::jsonb,
    '10000000-0000-4000-8000-000000000001',
    '[{"template_version_id":"20000000-0000-4000-8000-000000000001"},{"template_version_id":"20000000-0000-4000-8000-00000000000a"}]'::jsonb,
    true
  ) result
)
insert into catalog_test_context values ('account', (select (result->>'account_id')::uuid from created));

select is((select count(*) from public.benefit_definitions d
  where d.account_id = (select value from catalog_test_context where key = 'account')),
  2::bigint, 'bundle commits the account and exact selected benefit count');
select is((select renewal_date from public.accounts
  where id = (select value from catalog_test_context where key = 'account')),
  '2026-02-01'::date, 'annual-fee renewal is preserved independently');
select is((select benefit_anniversary_date from public.accounts
  where id = (select value from catalog_test_context where key = 'account')),
  '2026-03-15'::date, 'benefit anniversary is preserved independently');
select ok((select bool_and(origin_source = 'catalog' and origin_template_version_id is not null)
  from public.benefit_definitions d
  where d.account_id = (select value from catalog_test_context where key = 'account')),
  'exact template provenance is server-authored');
select ok((select bool_and(r.catalog_business_snapshot->>'origin_source' = 'catalog')
  from public.benefit_definition_revisions r join public.benefit_definitions d on d.id = r.definition_id
  where d.account_id = (select value from catalog_test_context where key = 'account')),
  'template provenance is retained in immutable revision snapshots');

select throws_ok($sql$
  select public.create_benefit(jsonb_build_object(
    'name','Injected','category','Testing','value_kind','money','benefit_amount',1,
    'currency','USD','effective_date',current_date,'end_date',current_date,
    'recurrence_type','one_time','recurrence_basis','none','origin_source','catalog'))
$sql$, '42501', 'manual benefit creation cannot set catalog provenance',
  'manual API rejects provenance injection');

select throws_ok($sql$
  select public.create_account_with_templates(
    '{"display_name":"Should Roll Back","issuer":"American Express","card_service_name":"Platinum Card","active":true}'::jsonb,
    '10000000-0000-4000-8000-000000000001',
    '[{"template_version_id":"20000000-0000-4000-8000-000000000001"},{"template_version_id":"20000000-0000-4000-8000-000000000028"}]'::jsonb,
    true)
$sql$, 'P0001', 'CATALOG_CHANGED: selected template version is no longer current',
  'retired/noncurrent exact template version is rejected');
select is((select count(*) from public.accounts where display_name = 'Should Roll Back'),
  0::bigint, 'a failed template selection rolls back the account atomically');

select throws_ok($sql$
  select public.create_benefit(jsonb_build_object(
    'name','Bad rule','category','Testing','value_kind','money','benefit_amount',10,
    'currency','USD','effective_date',date_trunc('year',current_date)::date,
    'recurrence_type','monthly','recurrence_basis','calendar',
    'period_value_rules','[{"calendar_month":12,"available_quantity":35,"extra":1}]'::jsonb))
$sql$, '22023', 'period value rules only support calendar_month and available_quantity',
  'unknown period-rule keys are rejected authoritatively');

reset role;
select private.materialize_definition(d.id, '2026-12-01', '2027-01-31', 'scheduler', true, false)
from public.benefit_definitions d
where d.account_id = (select value from catalog_test_context where key = 'account')
  and d.origin_template_stable_key = 'amex-platinum-uber-cash';
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select is((select available_quantity from public.benefit_instances i
  join public.benefit_definitions d on d.id = i.definition_id
  where d.origin_template_stable_key = 'amex-platinum-uber-cash'
    and extract(month from i.nominal_start) = 12 and i.voided_at is null limit 1),
  35.00::numeric, 'December Uber availability uses the narrow month rule');
select is((select available_quantity from public.benefit_instances i
  join public.benefit_definitions d on d.id = i.definition_id
  where d.origin_template_stable_key = 'amex-platinum-uber-cash'
    and extract(month from i.nominal_start) = 1 and i.nominal_start >= '2027-01-01'
    and i.voided_at is null limit 1),
  15.00::numeric, 'January Uber availability returns to the base amount');

insert into catalog_test_context
select 'uber_original_revision', r.id
from public.benefit_definition_revisions r
join public.benefit_definitions d on d.id = r.definition_id
where d.account_id = (select value from catalog_test_context where key = 'account')
  and d.origin_template_stable_key = 'amex-platinum-uber-cash'
  and r.revision_no = d.current_revision_no;

select lives_ok($sql$
  select public.edit_benefit(
    (select d.id from public.benefit_definitions d
      where d.account_id = (select value from catalog_test_context where key = 'account')
        and d.origin_template_stable_key = 'amex-platinum-uber-cash'),
    '{"period_value_rules":[{"calendar_month":12,"available_quantity":36}]}'::jsonb,
    'future_periods', null)
$sql$, 'a template benefit can be customized through the ordinary edit lifecycle');
select ok((select r.valid_to is not null and r.closed_at is not null
  from public.benefit_definition_revisions r
  where r.id = (select value from catalog_test_context where key = 'uber_original_revision')),
  'the ordinary edit closes the old immutable revision');
select is((select count(*) from public.benefit_definition_revisions r
  join public.benefit_definitions d on d.id = r.definition_id
  where d.account_id = (select value from catalog_test_context where key = 'account')
    and d.origin_template_stable_key = 'amex-platinum-uber-cash'
    and r.valid_to is null and r.closed_at is null),
  1::bigint, 'the ordinary edit leaves exactly one new open revision');
select is((select count(*) from public.benefit_definition_revisions r
  join public.benefit_definitions d on d.id = r.definition_id
  where d.account_id = (select value from catalog_test_context where key = 'account')
    and d.origin_template_stable_key = 'amex-platinum-uber-cash'
    and r.business_snapshot is not null and r.catalog_business_snapshot is not null),
  2::bigint, 'both generated snapshots remain stored on the closed and open revisions');
select ok((select d.customized_at is not null from public.benefit_definitions d
  where d.account_id = (select value from catalog_test_context where key = 'account')
    and d.origin_template_stable_key = 'amex-platinum-uber-cash'),
  'editing one template benefit records customized_at');
select ok((select d.customized_at is null from public.benefit_definitions d
  where d.account_id = (select value from catalog_test_context where key = 'account')
    and d.origin_template_stable_key = 'amex-platinum-oura'),
  'editing one template benefit does not customize its sibling');
select is((select (r.catalog_business_snapshot->'period_value_rules'->0->>'available_quantity')::numeric
  from public.benefit_definition_revisions r
  join public.benefit_definitions d on d.id = r.definition_id
  where d.origin_template_stable_key = 'amex-platinum-uber-cash'
  order by r.revision_no limit 1), 35::numeric,
  'the historical revision retains the original December rule');
select is((select (r.catalog_business_snapshot->'period_value_rules'->0->>'available_quantity')::numeric
  from public.benefit_definition_revisions r
  join public.benefit_definitions d on d.id = r.definition_id
  where d.origin_template_stable_key = 'amex-platinum-uber-cash'
  order by r.revision_no desc limit 1), 36::numeric,
  'the new revision snapshots the customized December rule');

reset role;
select throws_ok(format(
  'update public.benefit_definition_revisions set notes = coalesce(notes, '''') || %L where id = %L::uuid',
  ' unauthorized mutation',
  (select value from catalog_test_context where key = 'uber_original_revision')
), '55000', 'revision rows are immutable except for one authorized close transition',
  'direct mutation of a closed revision remains rejected by the history trigger');
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select lives_ok($sql$
  select public.create_account_with_templates(
    '{"display_name":"US Bank contingent","issuer":"U.S. Bank","card_service_name":"Altitude Go","active":true}'::jsonb,
    '10000000-0000-4000-8000-000000000007',
    '[{"template_version_id":"20000000-0000-4000-8000-00000000001e","setup":{"first_qualifying_month":"2026-08"}}]'::jsonb,
    true)
$sql$, 'contingent qualification marker can be created with explicit setup');
select ok((select bool_and(not expiration_reminder_enabled and not reactivation_reminder_enabled)
  from public.benefit_definitions where name = 'Expected Streaming Qualification Credit'),
  'contingent U.S. Bank marker never enables automatic reminders');
select is((select lifecycle_status from public.benefit_instance_dashboard
  where benefit_name = 'Expected Streaming Qualification Credit' limit 1),
  'upcoming'::text, 'qualification marker starts Upcoming rather than falsely Available');

reset role;
update private.card_catalog_product_versions set verified_on = current_date - 181
where id = '10000000-0000-4000-8000-000000000005';
update private.card_catalog_template_versions set verified_on = current_date - 181
where product_version_id = '10000000-0000-4000-8000-000000000005';
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select throws_ok($sql$
  select public.create_account_with_templates(
    '{"display_name":"Stale without ack","issuer":"Chase","card_service_name":"Sapphire Preferred","active":true}'::jsonb,
    '10000000-0000-4000-8000-000000000005', '[]'::jsonb, false)
$sql$, 'P0001', 'STALE_CATALOG_ACK_REQUIRED: catalog was verified more than 180 days ago',
  'server requires explicit acknowledgement for a catalog older than 180 days');
select lives_ok($sql$
  select public.create_account_with_templates(
    '{"display_name":"Stale with ack","issuer":"Chase","card_service_name":"Sapphire Preferred","active":true}'::jsonb,
    '10000000-0000-4000-8000-000000000005', '[]'::jsonb, true)
$sql$, 'explicit stale-catalog acknowledgement allows an empty-selection account');

reset role;
create temporary table catalog_import_payload (payload jsonb not null);
create temporary table catalog_import_result (result jsonb not null);
grant all on catalog_import_payload, catalog_import_result to authenticated;

with source as (
  select a, d, r
  from public.accounts a
  join public.benefit_definitions d on d.account_id = a.id
    and d.origin_template_stable_key = 'amex-platinum-uber-cash'
  join public.benefit_definition_revisions r on r.definition_id = d.id
    and r.revision_no = d.current_revision_no
  where a.id = (select value from catalog_test_context where key = 'account')
), facts as (
  select source.*,
    platinum.id as platinum_id, platinum.stable_key as platinum_key,
    platinum.version as platinum_version, platinum.content_hash as platinum_hash,
    gold.id as gold_id, gold.stable_key as gold_key,
    gold.version as gold_version, gold.content_hash as gold_hash,
    uber.id as uber_id, uber.stable_key as uber_key, uber.version as uber_version,
    uber.content_hash as uber_hash, uber.verified_on as uber_verified,
    dining.id as dining_id, dining.stable_key as dining_key, dining.version as dining_version,
    dining.content_hash as dining_hash, dining.verified_on as dining_verified
  from source
  join private.card_catalog_product_versions platinum
    on platinum.stable_key = 'amex-platinum-us-consumer' and platinum.is_current
  join private.card_catalog_product_versions gold
    on gold.stable_key = 'amex-gold-us-consumer' and gold.is_current
  join private.card_catalog_template_versions uber
    on uber.stable_key = 'amex-platinum-uber-cash' and uber.is_current
  join private.card_catalog_template_versions dining
    on dining.stable_key = 'amex-gold-dining' and dining.is_current
)
insert into catalog_import_payload
select jsonb_build_object(
  'schema_version', 2,
  'exported_at', statement_timestamp(),
  'timezone', 'Pacific/Honolulu',
  'accounts', jsonb_build_array(
    (to_jsonb(a) - array['id','user_id','created_at','updated_at']) || jsonb_build_object(
      'id','91000000-0000-4000-8000-000000000001','display_name','Imported duplicate account',
      'issuer','American Express','origin_product_version_id',platinum_id,
      'origin_product_stable_key',platinum_key,'origin_product_version',platinum_version,
      'origin_product_hash',platinum_hash),
    (to_jsonb(a) - array['id','user_id','created_at','updated_at']) || jsonb_build_object(
      'id','91000000-0000-4000-8000-000000000002','display_name','Imported duplicate account',
      'issuer','American Express','origin_product_version_id',gold_id,
      'origin_product_stable_key',gold_key,'origin_product_version',gold_version,
      'origin_product_hash',gold_hash),
    (to_jsonb(a) - array['id','user_id','created_at','updated_at']) || jsonb_build_object(
      'id','91000000-0000-4000-8000-000000000003','display_name','Imported duplicate account',
      'issuer','American Express','origin_product_version_id',gold_id,
      'origin_product_stable_key',gold_key,'origin_product_version',gold_version,
      'origin_product_hash','not-the-installed-hash')
  ),
  'definitions', jsonb_build_array(
    (to_jsonb(d) - array['id','user_id','created_at','updated_at']) || jsonb_build_object(
      'id','92000000-0000-4000-8000-000000000001',
      'account_id','91000000-0000-4000-8000-000000000001',
      'name','Imported duplicate benefit','current_revision_no',1,
      'origin_source','catalog','origin_template_version_id',uber_id,
      'origin_template_stable_key',uber_key,'origin_template_version',uber_version,
      'origin_template_hash',uber_hash,'origin_verified_on',uber_verified),
    (to_jsonb(d) - array['id','user_id','created_at','updated_at']) || jsonb_build_object(
      'id','92000000-0000-4000-8000-000000000002',
      'account_id','91000000-0000-4000-8000-000000000002',
      'name','Imported duplicate benefit','current_revision_no',1,
      'origin_source','catalog','origin_template_version_id',dining_id,
      'origin_template_stable_key',dining_key,'origin_template_version',dining_version,
      'origin_template_hash',dining_hash,'origin_verified_on',dining_verified),
    (to_jsonb(d) - array['id','user_id','created_at','updated_at']) || jsonb_build_object(
      'id','92000000-0000-4000-8000-000000000003',
      'account_id','91000000-0000-4000-8000-000000000003',
      'name','Imported duplicate benefit','current_revision_no',1,
      'origin_source','catalog','origin_template_version_id',dining_id,
      'origin_template_stable_key',dining_key,'origin_template_version',dining_version,
      'origin_template_hash','not-the-installed-hash','origin_verified_on',dining_verified,
      'customized_at','2026-08-25T12:00:00+00','terms_timezone','Pacific/Kiritimati',
      'period_value_rules','[{"calendar_month":12,"available_quantity":31}]'::jsonb)
  ),
  'revisions', jsonb_build_array(
    (to_jsonb(r) - array['id','user_id','created_at','catalog_business_snapshot']) || jsonb_build_object(
      'id','93000000-0000-4000-8000-000000000001',
      'definition_id','92000000-0000-4000-8000-000000000001',
      'account_id','91000000-0000-4000-8000-000000000001',
      'name','Imported duplicate benefit','revision_no',1,'valid_to',null,
      'origin_source','catalog','origin_template_version_id',uber_id,
      'origin_template_stable_key',uber_key,'origin_template_version',uber_version,
      'origin_template_hash',uber_hash,'origin_verified_on',uber_verified),
    (to_jsonb(r) - array['id','user_id','created_at','catalog_business_snapshot']) || jsonb_build_object(
      'id','93000000-0000-4000-8000-000000000002',
      'definition_id','92000000-0000-4000-8000-000000000002',
      'account_id','91000000-0000-4000-8000-000000000002',
      'name','Imported duplicate benefit','revision_no',1,'valid_to',null,
      'origin_source','catalog','origin_template_version_id',dining_id,
      'origin_template_stable_key',dining_key,'origin_template_version',dining_version,
      'origin_template_hash',dining_hash,'origin_verified_on',dining_verified),
    (to_jsonb(r) - array['id','user_id','created_at','catalog_business_snapshot']) || jsonb_build_object(
      'id','93000000-0000-4000-8000-000000000003',
      'definition_id','92000000-0000-4000-8000-000000000003',
      'account_id','91000000-0000-4000-8000-000000000003',
      'name','Imported duplicate benefit','revision_no',1,'valid_to',null,
      'origin_source','catalog','origin_template_version_id',dining_id,
      'origin_template_stable_key',dining_key,'origin_template_version',dining_version,
      'origin_template_hash','not-the-installed-hash','origin_verified_on',dining_verified,
      'customized_at','2026-08-25T18:00:00+00','terms_timezone','Pacific/Honolulu',
      'period_value_rules','[{"calendar_month":12,"available_quantity":32}]'::jsonb)
  ),
  'instances','[]'::jsonb,
  'redemptions','[]'::jsonb
)
from facts;

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
insert into catalog_import_result
select public.import_backup(payload, 'import_as_new', 'suppress_current')
from catalog_import_payload;

reset role;
select is((select count(*) from public.accounts where display_name = 'Imported duplicate account'),
  3::bigint, 'duplicate account names import as three source-identity-mapped accounts');
select is((select count(*) from public.benefit_definitions d join public.accounts a on a.id = d.account_id
  where d.name = 'Imported duplicate benefit' and d.origin_template_stable_key = 'amex-platinum-uber-cash'
    and a.origin_product_stable_key = 'amex-platinum-us-consumer'),
  1::bigint, 'the first same-named benefit retains only its exact source template and account provenance');
select is((select count(*) from public.benefit_definitions d join public.accounts a on a.id = d.account_id
  where d.name = 'Imported duplicate benefit' and d.origin_template_stable_key = 'amex-gold-dining'
    and a.origin_product_stable_key = 'amex-gold-us-consumer'),
  1::bigint, 'the second same-named benefit retains only its exact source template and account provenance');
select is((select count(*) from public.benefit_definitions d join public.accounts a on a.id = d.account_id
  where d.name = 'Imported duplicate benefit' and d.origin_source = 'manual'
    and a.origin_product_version_id is null),
  1::bigint, 'a mismatched version hash degrades only that source record to manual provenance');
select is((select count(*)
  from public.benefit_definitions d
  join public.benefit_definition_revisions r
    on r.definition_id = d.id and r.revision_no = d.current_revision_no
  join public.accounts a on a.id = d.account_id
  where d.name = 'Imported duplicate benefit'
    and ((a.origin_product_stable_key = 'amex-platinum-us-consumer'
      and d.origin_template_stable_key = 'amex-platinum-uber-cash'
      and r.origin_template_stable_key = 'amex-platinum-uber-cash')
    or (a.origin_product_stable_key = 'amex-gold-us-consumer'
      and d.origin_template_stable_key = 'amex-gold-dining'
      and r.origin_template_stable_key = 'amex-gold-dining'))),
  2::bigint, 'exact same-name source identities restore the matching account, definition, and revision provenance');
select ok((select d.origin_source = 'manual'
    and d.origin_template_version_id is null
    and d.origin_template_stable_key is null
    and d.origin_template_version is null
    and d.origin_template_hash is null
    and d.origin_verified_on is null
    and d.customized_at is null
  from public.benefit_definitions d
  join public.accounts a on a.id = d.account_id
  where d.name = 'Imported duplicate benefit' and a.origin_product_version_id is null),
  'a degraded current definition clears provenance, verification, and customized metadata');
select ok((select r.origin_source = 'manual'
    and r.origin_template_version_id is null
    and r.origin_template_stable_key is null
    and r.origin_template_version is null
    and r.origin_template_hash is null
    and r.origin_verified_on is null
    and r.customized_at is null
  from public.benefit_definition_revisions r
  join public.benefit_definitions d on d.id = r.definition_id
  join public.accounts a on a.id = d.account_id
  where d.name = 'Imported duplicate benefit' and a.origin_product_version_id is null
    and r.revision_no = d.current_revision_no and r.valid_to is null),
  'the degraded open revision inherits the definition manual/null provenance contract');
select is((select d.terms_timezone from public.benefit_definitions d
  join public.accounts a on a.id = d.account_id
  where d.name = 'Imported duplicate benefit' and a.origin_product_version_id is null),
  'Pacific/Kiritimati'::text,
  'the degraded definition retains its legitimate imported issuer timezone');
select is((select r.terms_timezone from public.benefit_definition_revisions r
  join public.benefit_definitions d on d.id = r.definition_id
  join public.accounts a on a.id = d.account_id
  where d.name = 'Imported duplicate benefit' and a.origin_product_version_id is null
    and r.revision_no = d.current_revision_no and r.valid_to is null),
  'Pacific/Kiritimati'::text,
  'a malformed open-revision timezone cannot override the imported definition');
select is((select (r.period_value_rules->0->>'available_quantity')::numeric
  from public.benefit_definition_revisions r
  join public.benefit_definitions d on d.id = r.definition_id
  join public.accounts a on a.id = d.account_id
  where d.name = 'Imported duplicate benefit' and a.origin_product_version_id is null
    and r.revision_no = d.current_revision_no and r.valid_to is null),
  31::numeric,
  'a malformed open-revision month rule cannot override the imported definition rule');
select is((select r.catalog_business_snapshot
  from public.benefit_definition_revisions r
  join public.benefit_definitions d on d.id = r.definition_id
  join public.accounts a on a.id = d.account_id
  where d.name = 'Imported duplicate benefit' and a.origin_product_version_id is null
    and r.revision_no = d.current_revision_no and r.valid_to is null),
  (select private.make_catalog_revision_snapshot(
    d.origin_source, d.origin_template_version_id, d.origin_template_stable_key,
    d.origin_template_version, d.origin_template_hash, d.origin_verified_on,
    d.customized_at, d.terms_timezone, d.period_value_rules)
  from public.benefit_definitions d
  join public.accounts a on a.id = d.account_id
  where d.name = 'Imported duplicate benefit' and a.origin_product_version_id is null),
  'the degraded definition and current/open revision have the exact same catalog snapshot');
select ok((select jsonb_array_length(result->'provenance_warnings') >= 2 from catalog_import_result),
  'the v2 import returns structured account and benefit provenance degradation warnings');

update public.profiles
set timezone = 'Pacific/Honolulu', expiration_reminders_enabled = false,
  reactivation_reminders_enabled = false
where user_id = '11111111-1111-4111-8111-111111111111';

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'authenticated', 'authenticated', 'catalog-scheduler@example.test', '',
  statement_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb, statement_timestamp(), statement_timestamp(), '', '', '', ''
) on conflict (id) do nothing;
update public.profiles
set timezone = 'Pacific/Honolulu', expiration_reminders_enabled = false,
  reactivation_reminders_enabled = true
where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

select is((private.expand_catalog_template(
    (select t from private.card_catalog_template_versions t
      where t.stable_key = 'amex-platinum-uber-cash' and t.is_current),
    (select value from catalog_test_context where key = 'account'), null, '{}'::jsonb
  )->>'effective_date')::date,
  date_trunc('year', statement_timestamp() at time zone 'America/New_York')::date,
  'an Eastern-terms template uses the issuer year while the profile is Pacific');
select is(('2027-01-01 05:30:00+00'::timestamptz at time zone 'America/New_York')::date,
  '2027-01-01'::date, 'Eastern issuer terms have crossed January 1 at the fixed boundary instant');
select is(('2027-01-01 05:30:00+00'::timestamptz at time zone 'Pacific/Honolulu')::date,
  '2026-12-31'::date, 'a Pacific profile remains in December at that same instant');
select is(('2026-12-31 12:30:00+00'::timestamptz at time zone 'Pacific/Kiritimati')::date,
  '2027-01-01'::date, 'an ahead-zone issuer boundary reaches January while Eastern time remains in December');
create temporary table catalog_scheduler_claims (
  sequence integer,
  notification_id uuid,
  claim_token uuid,
  idempotency_key uuid,
  frozen_payload jsonb,
  frozen_payload_text text,
  payload_sha256 text,
  first_attempt_at timestamptz,
  attempt_count integer
);
grant all on catalog_scheduler_claims to service_role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}', true);
with created as (
  select public.create_benefit(jsonb_build_object(
    'name','Issuer-zone reactivation','category','Testing','value_kind','money',
    'benefit_amount',12,'currency','USD',
    'effective_date',(statement_timestamp() at time zone 'Pacific/Kiritimati')::date,
    'recurrence_type','monthly','recurrence_basis','anniversary','interval_months',1,
    'anchor_date',(statement_timestamp() at time zone 'Pacific/Kiritimati')::date - 10,
    'terms_timezone','Pacific/Kiritimati','expiration_reminder_enabled',false,
    'reactivation_reminder_enabled',true
  )) result
)
insert into catalog_test_context values (
  'timezone_reactivation_definition', (select (result->>'definition_id')::uuid from created));

reset role;
delete from public.benefit_instances
where definition_id = (select value from catalog_test_context
  where key = 'timezone_reactivation_definition');
set local role service_role;
insert into catalog_test_context values ('timezone_reactivation_job', public.scheduler_begin_run('test'));
select lives_ok(format(
  'select * from public.scheduler_prepare_work(%L::uuid, 24)',
  (select value from catalog_test_context where key = 'timezone_reactivation_job')
), 'terms-zone scheduler preparation generates a due recurring period without manual eligibility changes');
select lives_ok(format(
  'select * from public.scheduler_prepare_work(%L::uuid, 24)',
  (select value from catalog_test_context where key = 'timezone_reactivation_job')
), 'repeated terms-zone preparation remains idempotent');
reset role;
insert into catalog_test_context
select 'timezone_reactivation_instance', i.id
from public.benefit_instances i
join public.benefit_definition_revisions r on r.id = i.revision_id
where i.definition_id = (select value from catalog_test_context
    where key = 'timezone_reactivation_definition')
  and (statement_timestamp() at time zone r.terms_timezone)::date
    between i.period_start and i.period_end
  and i.voided_at is null;
select is((select i.generated_source from public.benefit_instances i
  where i.id = (select value from catalog_test_context where key = 'timezone_reactivation_instance')),
  'scheduler'::public.instance_source,
  'the due reactivation fixture is generated by the scheduler rather than creation');
select ok((select i.nominal_start < i.period_start from public.benefit_instances i
  where i.id = (select value from catalog_test_context where key = 'timezone_reactivation_instance')),
  'the fixture distinguishes its nominal recurrence start from its actual validity start');
select is((select i.period_start from public.benefit_instances i
  where i.id = (select value from catalog_test_context where key = 'timezone_reactivation_instance')),
  (statement_timestamp() at time zone 'Pacific/Kiritimati')::date,
  'the actual period starts on issuer-terms today');
select ok((select i.reactivation_eligible from public.benefit_instances i
  where i.id = (select value from catalog_test_context where key = 'timezone_reactivation_instance')),
  'a scheduler-generated due period preserves legitimate reactivation eligibility');
select is((select count(*) from public.notifications n
  where n.benefit_instance_id = (select value from catalog_test_context
    where key = 'timezone_reactivation_instance')
    and n.notification_type = 'reactivation'),
  1::bigint, 'prepare creates one logical reactivation notification');
select is((select n.scheduled_for from public.notifications n
  join public.benefit_instances i on i.id = n.benefit_instance_id
  join public.benefit_definition_revisions r on r.id = i.revision_id
  where n.benefit_instance_id = (select value from catalog_test_context
    where key = 'timezone_reactivation_instance') and n.notification_type = 'reactivation'),
  (select i.period_start::timestamp at time zone r.terms_timezone
    from public.benefit_instances i
    join public.benefit_definition_revisions r on r.id = i.revision_id
    where i.id = (select value from catalog_test_context where key = 'timezone_reactivation_instance')),
  'reactivation is scheduled at issuer-terms midnight rather than profile midnight');
select is(
  (statement_timestamp() at time zone 'Pacific/Kiritimati')::date,
  (statement_timestamp() at time zone 'Pacific/Honolulu')::date + 1,
  'the boundary fixture places issuer terms one calendar day ahead of the profile zone');

set local role service_role;
insert into catalog_scheduler_claims
select 1, claim.* from public.scheduler_claim_notifications(
  (select value from catalog_test_context where key = 'timezone_reactivation_job'),
  10, 180, 'benefits@example.test') claim;
reset role;
select is((select count(*) from catalog_scheduler_claims where sequence = 1),
  1::bigint, 'a due issuer-zone reactivation is claimable while the profile is still on the prior day');
set local role service_role;
select ok(public.scheduler_record_notification_outcome(
  (select notification_id from catalog_scheduler_claims where sequence = 1),
  (select claim_token from catalog_scheduler_claims where sequence = 1),
  'provider_accepted', 'catalog-reactivation-test-message', null, null
), 'provider acceptance is recorded for the issuer-zone reactivation');
select lives_ok(format(
  'select * from public.scheduler_prepare_work(%L::uuid, 24)',
  (select value from catalog_test_context where key = 'timezone_reactivation_job')
), 'accepted reactivation can be revisited safely by preparation');
insert into catalog_scheduler_claims
select 2, claim.* from public.scheduler_claim_notifications(
  (select value from catalog_test_context where key = 'timezone_reactivation_job'),
  10, 180, 'benefits@example.test') claim;
reset role;
select is((select count(*) from catalog_scheduler_claims where sequence = 2),
  0::bigint, 'prepare, claim, provider acceptance, and prepare again never duplicate delivery');

select * from finish();
rollback;
