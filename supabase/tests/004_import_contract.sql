begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

create temporary table import_result (payload jsonb);
create temporary table definition_only_result (payload jsonb);
create temporary table confirmation_import_result (payload jsonb);
grant all on table import_result, definition_only_result to authenticated;
grant all on table confirmation_import_result to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

insert into import_result(payload)
select public.import_backup(
  jsonb_build_object(
    'schema_version', 1,
    'accounts', jsonb_build_array(jsonb_build_object(
      'id', 'source-account-1',
      'display_name', 'Imported Account',
      'issuer', 'Imported Provider',
      'active', true
    )),
    'definitions', jsonb_build_array(jsonb_build_object(
      'id', 'source-definition-1',
      'account_id', 'source-account-1',
      'name', 'Imported annual credit',
      'category', 'Travel',
      'active', true,
      'recurrence_enabled', false,
      'value_kind', 'money',
      'benefit_amount', 100,
      'currency', 'USD',
      'enrollment_required', false,
      'effective_date', current_date,
      'end_date', current_date + 10,
      'recurrence_type', 'one_time',
      'recurrence_basis', 'none',
      'current_revision_no', 1,
      'expiration_reminder_enabled', true,
      'reactivation_reminder_enabled', true
    )),
    'revisions', jsonb_build_array(jsonb_build_object(
      'id', 'source-revision-1',
      'definition_id', 'source-definition-1',
      'revision_no', 1,
      'valid_from', current_date,
      'account_id', 'source-account-1',
      'name', 'Imported annual credit',
      'category', 'Travel',
      'value_kind', 'money',
      'benefit_amount', 100,
      'currency', 'USD',
      'enrollment_required', false,
      'effective_date', current_date,
      'end_date', current_date + 10,
      'recurrence_type', 'one_time',
      'recurrence_basis', 'none',
      'expiration_reminder_enabled', true,
      'reactivation_reminder_enabled', true
    )),
    'instances', jsonb_build_array(jsonb_build_object(
      'id', 'source-instance-1',
      'definition_id', 'source-definition-1',
      'revision_id', 'source-revision-1',
      'occurrence_key', 'once:import-fixture',
      'instance_version', 1,
      'recurrence_sequence', 0,
      'nominal_start', current_date,
      'nominal_end', current_date + 10,
      'period_start', current_date,
      'period_end', current_date + 10,
      'value_kind', 'money',
      'available_quantity', 100,
      'is_uncapped', false,
      'currency', 'USD',
      'unit_label', 'USD',
      'period_label', 'Imported current period'
    )),
    'redemptions', jsonb_build_array(jsonb_build_object(
      'id', 'source-redemption-1',
      'benefit_instance_id', 'source-instance-1',
      'redeemed_quantity', 40,
      'used_date', current_date,
      'merchant', 'Imported Hotel'
    )),
    'notifications', jsonb_build_array(jsonb_build_object(
      'id', 'untrusted-notification', 'state', 'provider_accepted'
    ))
  ),
  'import_as_new',
  'suppress_current'
);

select is((payload->>'accounts_imported')::integer, 1, 'one account is re-keyed and imported')
from import_result;
select is((payload->>'definitions_imported')::integer, 1, 'one definition is re-keyed and imported')
from import_result;
select is((payload->>'revisions_imported')::integer, 1, 'immutable revision history is restored')
from import_result;
select is((payload->>'instances_imported')::integer, 1, 'period history is restored')
from import_result;
select is((payload->>'redemptions_imported')::integer, 1, 'redemption history is restored')
from import_result;

select is((
  select d.user_id from public.benefit_definitions d where d.name = 'Imported annual credit'
), '11111111-1111-4111-8111-111111111111'::uuid,
  'incoming ownership is ignored and replaced with auth.uid');
select isnt((
  select d.id::text from public.benefit_definitions d where d.name = 'Imported annual credit'
), 'source-definition-1', 'source identifiers are never trusted as destination identifiers');
select is((
  select d.remaining_quantity from public.benefit_instance_dashboard d
  where d.benefit_name = 'Imported annual credit'
), 60.00::numeric, 'mapped redemption preserves the restored remaining balance');
select ok((
  select i.expiration_notification_suppressed and not i.reactivation_eligible
  from public.benefit_instances i
  join public.benefit_definitions d on d.id = i.definition_id
  where d.name = 'Imported annual credit'
), 'default restore suppresses unknown duplicate expiration and reactivation mail');
select is((
  select count(*) from public.notifications n
  join public.benefit_instances i on i.id = n.benefit_instance_id
  join public.benefit_definitions d on d.id = i.definition_id
  where d.name = 'Imported annual credit'
), 0::bigint, 'incoming notification authority is ignored');

insert into confirmation_import_result(payload)
select public.import_backup(
  jsonb_build_object(
    'schema_version', 1,
    'accounts', '[]'::jsonb,
    'definitions', jsonb_build_array(jsonb_build_object(
      'id', 'source-confirmation-definition',
      'name', 'Imported confirmed one-time credit',
      'category', 'Testing',
      'value_kind', 'money',
      'benefit_amount', 100,
      'currency', 'USD',
      'effective_date', current_date,
      'end_date', current_date + 10,
      'recurrence_type', 'one_time',
      'recurrence_basis', 'none'
    )),
    'revisions', jsonb_build_array(jsonb_build_object(
      'id', 'source-confirmation-revision',
      'definition_id', 'source-confirmation-definition',
      'revision_no', 1,
      'valid_from', current_date,
      'name', 'Imported confirmed one-time credit',
      'category', 'Testing',
      'value_kind', 'money',
      'benefit_amount', 100,
      'currency', 'USD',
      'effective_date', current_date,
      'end_date', current_date + 10,
      'recurrence_type', 'one_time',
      'recurrence_basis', 'none'
    )),
    'instances', jsonb_build_array(jsonb_build_object(
      'id', 'source-confirmation-instance',
      'definition_id', 'source-confirmation-definition',
      'revision_id', 'source-confirmation-revision',
      'occurrence_key', 'once:import-confirmed',
      'instance_version', 1,
      'recurrence_sequence', 0,
      'nominal_start', current_date,
      'nominal_end', current_date + 10,
      'period_start', current_date,
      'period_end', current_date + 10,
      'value_kind', 'money',
      'available_quantity', 100,
      'is_uncapped', false,
      'currency', 'USD',
      'unit_label', 'USD',
      'period_label', 'Imported confirmed current period',
      'confirmation_redemption_id', 'source-confirmation-redemption',
      'confirmation_manual_completion', false,
      'voided_at', current_date,
      'void_reason', 'Confirmed used; archived from dashboard'
    )),
    'redemptions', jsonb_build_array(
      jsonb_build_object(
        'id', 'source-confirmation-pre-existing',
        'benefit_instance_id', 'source-confirmation-instance',
        'redeemed_quantity', 40,
        'used_date', current_date,
        'notes', 'Pre-existing imported usage'
      ),
      jsonb_build_object(
        'id', 'source-confirmation-redemption',
        'benefit_instance_id', 'source-confirmation-instance',
        'redeemed_quantity', 60,
        'used_date', current_date,
        'notes', 'Confirmed used from dashboard.'
      )
    )
  ),
  'import_as_new',
  'suppress_current'
);

select is((payload->>'instances_imported')::integer, 1,
  'archived confirmation instance is restored')
from confirmation_import_result;
select is((payload->>'redemptions_imported')::integer, 2,
  'confirmation and pre-existing redemptions are both restored')
from confirmation_import_result;
select ok((
  select i.confirmation_redemption_id is not null
    and i.confirmation_redemption_id::text <> 'source-confirmation-redemption'
    and i.confirmation_manual_completion = false
  from public.benefit_instances i
  join public.benefit_definitions d on d.id = i.definition_id
  where d.name = 'Imported confirmed one-time credit'
), 'restore remaps confirmation identity without trusting the source redemption id');
select lives_ok(format(
  'select public.reopen_confirmed_benefit_period(%L::uuid)',
  (select i.id
   from public.benefit_instances i
   join public.benefit_definitions d on d.id = i.definition_id
   where d.name = 'Imported confirmed one-time credit')
), 'restored confirmation remains correctable after redemption ids change');
select is((select count(*)
  from public.redemptions r
  join public.benefit_instances i on i.id = r.benefit_instance_id
  join public.benefit_definitions d on d.id = i.definition_id
  where d.name = 'Imported confirmed one-time credit'),
  1::bigint, 'restored correction removes only the remapped confirmation redemption');
select is((select sum(r.redeemed_quantity)
  from public.redemptions r
  join public.benefit_instances i on i.id = r.benefit_instance_id
  join public.benefit_definitions d on d.id = i.definition_id
  where d.name = 'Imported confirmed one-time credit'),
  40::numeric, 'restored correction preserves the pre-existing redemption');

insert into definition_only_result(payload)
select public.import_backup(
  jsonb_build_object(
    'schema_version', 1,
    'accounts', '[]'::jsonb,
    'definitions', jsonb_build_array(jsonb_build_object(
      'id', 'source-definition-only',
      'name', 'Imported definition-only monthly credit',
      'category', 'Testing',
      'active', true,
      'recurrence_enabled', true,
      'value_kind', 'money',
      'benefit_amount', 20,
      'currency', 'USD',
      'effective_date', date_trunc('month', current_date)::date,
      'recurrence_type', 'monthly',
      'recurrence_basis', 'calendar',
      'interval_months', 1,
      'display_reset_date', current_date + 15
    )),
    'revisions', '[]'::jsonb,
    'instances', '[]'::jsonb,
    'redemptions', '[]'::jsonb
  ),
  'import_as_new',
  'suppress_current'
);

select is((payload->>'definitions_imported')::integer, 1,
  'definition-only import restores one validated master')
from definition_only_result;
select ok((payload->>'instances_materialized')::integer >= 2,
  'definition-only recurring import materializes current and upcoming periods')
from definition_only_result;
select is((
  select count(*)
  from public.benefit_instances i
  join public.benefit_definitions d on d.id = i.definition_id
  where d.name = 'Imported definition-only monthly credit'
    and i.voided_at is null
    and current_date between i.period_start and i.period_end
), 1::bigint, 'definition-only import has exactly one live current occurrence');
select ok((
  select bool_and(not i.reactivation_eligible and i.expiration_notification_suppressed)
  from public.benefit_instances i
  join public.benefit_definitions d on d.id = i.definition_id
  where d.name = 'Imported definition-only monthly credit'
), 'generated import periods suppress untrusted prior notification state');
select is((
  select r.valid_from
  from public.benefit_definition_revisions r
  join public.benefit_definitions d on d.id = r.definition_id
  where d.name = 'Imported definition-only monthly credit'
), date_trunc('month', current_date)::date - 1,
  'generated first revision leaves the genuine first occurrence boundary editable');
select is((
  select r.display_reset_date
  from public.benefit_definition_revisions r
  join public.benefit_definitions d on d.id = r.definition_id
  where d.name = 'Imported definition-only monthly credit'
), current_date + 15, 'definition-only import preserves reset date in its immutable revision');
select is((
  select d.display_reset_date
  from public.benefit_instance_overview d
  where d.benefit_name = 'Imported definition-only monthly credit'
  order by d.period_start limit 1
), current_date + 15, 'imported reset date is exposed by the live overview');

select throws_ok($sql$
  select public.import_backup(
    jsonb_build_object(
      'schema_version', 1,
      'accounts', '[]'::jsonb,
      'definitions', jsonb_build_array(jsonb_build_object(
        'id', 'bad-definition', 'account_id', 'missing-account',
        'name', 'Must Roll Back', 'category', 'Test', 'value_kind', 'money',
        'benefit_amount', 10, 'currency', 'USD',
        'effective_date', current_date, 'end_date', current_date + 1,
        'recurrence_type', 'one_time', 'recurrence_basis', 'none'
      )),
      'revisions', '[]'::jsonb, 'instances', '[]'::jsonb, 'redemptions', '[]'::jsonb
    ), 'import_as_new', 'suppress_current'
  )
$sql$, '23503', 'definition references an unknown account',
  'bad cross-reference aborts the entire import statement');
select is((select count(*) from public.benefit_definitions where name = 'Must Roll Back'),
  0::bigint, 'malformed import leaves no partial definition');

select throws_ok($sql$
  select public.import_backup(
    jsonb_build_object('schema_version', 1, 'padding', repeat('x', 5 * 1024 * 1024)),
    'skip', 'suppress_current'
  )
$sql$, '54000', 'backup exceeds the 5 MiB limit', 'oversize backup is rejected before processing');

select throws_ok($sql$
  select public.import_backup(
    jsonb_build_object(
      'schema_version', 1,
      'accounts', (select jsonb_agg(jsonb_build_object('id', g)) from generate_series(1, 5001) g),
      'definitions', '[]'::jsonb, 'revisions', '[]'::jsonb,
      'instances', '[]'::jsonb, 'redemptions', '[]'::jsonb
    ), 'skip', 'suppress_current'
  )
$sql$, '54000', 'backup exceeds the 5,000 row limit', 'row-count safety bound is enforced');

reset role;
select * from finish();
rollback;
