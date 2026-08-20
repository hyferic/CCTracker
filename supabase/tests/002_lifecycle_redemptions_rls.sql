begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'authenticated', 'authenticated', 'other-owner@example.test', '', statement_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  statement_timestamp(), statement_timestamp(), '', '', '', ''
) on conflict (id) do nothing;

create temporary table test_context (key text primary key, value uuid);
grant all on table test_context to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

select throws_ok($sql$
  select public.update_profile_settings('{"notification_email":"not-an-email"}'::jsonb)
$sql$, '22023', 'notification email syntax is invalid',
  'profile RPC rejects a malformed notification recipient authoritatively');
select throws_ok($sql$
  select public.update_profile_settings('{"notification_email":"other-owner@example.test"}'::jsonb)
$sql$, '22023', 'notification email must match the confirmed authentication email in v1',
  'profile RPC rejects an unverified custom notification recipient');
select lives_ok($sql$
  select public.update_profile_settings('{"notification_email":"OWNER@EXAMPLE.TEST"}'::jsonb)
$sql$, 'confirmed authentication email is accepted case-insensitively');
select is((select notification_email from public.profiles
  where user_id = '11111111-1111-4111-8111-111111111111'),
  'owner@example.test', 'verified notification email is stored canonically');
select lives_ok($sql$
  select public.update_profile_settings('{"notification_email":null}'::jsonb)
$sql$, 'notification recipient can return to the confirmed Auth-email fallback');
select is((select notification_email from public.profiles
  where user_id = '11111111-1111-4111-8111-111111111111'),
  null::text, 'null custom recipient preserves the safe confirmed-email fallback');

with created as (
  select public.create_benefit(jsonb_build_object(
    'account_id', '22222222-2222-4222-8222-222222222222',
    'name', 'pgTAP monthly credit',
    'category', 'Testing',
    'value_kind', 'money',
    'benefit_amount', 50,
    'currency', 'USD',
    'effective_date', date_trunc('month', current_date)::date,
    'recurrence_type', 'monthly',
    'recurrence_basis', 'calendar',
    'interval_months', 1,
    'display_reset_date', current_date + 12
  )) as result
)
insert into test_context(key, value)
select 'definition', (result->>'definition_id')::uuid from created;

insert into test_context(key, value)
select 'current_instance', i.id
from public.benefit_instances i
where i.definition_id = (select value from test_context where key = 'definition')
  and current_date between i.period_start and i.period_end and i.voided_at is null;

insert into test_context(key, value)
select 'future_instance', i.id
from public.benefit_instances i
where i.definition_id = (select value from test_context where key = 'definition')
  and i.period_start > current_date and i.voided_at is null
order by i.period_start limit 1;

select ok((select value is not null from test_context where key = 'definition'), 'create_benefit returns a definition id');
select is((
  select count(*) from public.benefit_definition_revisions r
  where r.definition_id = (select value from test_context where key = 'definition')
), 1::bigint, 'creation writes revision one atomically');
select is((
  select r.display_reset_date from public.benefit_definition_revisions r
  where r.definition_id = (select value from test_context where key = 'definition')
), current_date + 12, 'optional display reset date is revisioned with business configuration');
select is((
  select d.display_reset_date from public.benefit_instance_dashboard d
  where d.definition_id = (select value from test_context where key = 'definition')
    and d.is_live order by d.period_start limit 1
), current_date + 12, 'display reset date is available through the dashboard read model');
select ok((
  select count(*) >= 2 from public.benefit_instances i
  where i.definition_id = (select value from test_context where key = 'definition') and i.voided_at is null
), 'monthly creation materializes current and future periods');

select throws_ok($sql$
  select public.create_benefit(jsonb_build_object(
    'name', 'Invalid precision', 'category', 'Testing', 'value_kind', 'money',
    'benefit_amount', 1.005, 'currency', 'USD',
    'effective_date', current_date, 'end_date', current_date + 1,
    'recurrence_type', 'one_time', 'recurrence_basis', 'none'
  ))
$sql$, '22023', 'benefit_amount accepts at most two fractional digits',
  'fiat input is rejected rather than silently rounded');

select throws_ok($sql$
  select public.create_benefit(jsonb_build_object(
    'name', 'Invalid one-time reset date', 'category', 'Testing',
    'value_kind', 'money', 'benefit_amount', 10, 'currency', 'USD',
    'effective_date', current_date, 'end_date', current_date + 10,
    'recurrence_type', 'one_time', 'recurrence_basis', 'none',
    'display_reset_date', current_date + 5
  ))
$sql$, '23514',
  'new row for relation "benefit_definitions" violates check constraint "benefit_definition_display_reset_date"',
  'one-time benefits cannot claim a recurring reset date');

select throws_ok($sql$
  select public.create_benefit(jsonb_build_object(
    'name', 'Invalid out-of-range reset date', 'category', 'Testing',
    'value_kind', 'money', 'benefit_amount', 10, 'currency', 'USD',
    'effective_date', current_date, 'end_date', current_date + 10,
    'recurrence_type', 'monthly', 'recurrence_basis', 'calendar',
    'interval_months', 1, 'display_reset_date', current_date + 11
  ))
$sql$, '23514',
  'new row for relation "benefit_definitions" violates check constraint "benefit_definition_display_reset_date"',
  'display reset dates must remain inside the configured benefit validity range');

with created as (
  select public.create_benefit(jsonb_build_object(
    'name', 'pgTAP editable first occurrence', 'category', 'Testing',
    'value_kind', 'money', 'benefit_amount', 10, 'currency', 'USD',
    'effective_date', current_date, 'end_date', current_date + 5,
    'recurrence_type', 'one_time', 'recurrence_basis', 'none'
  )) as result
)
insert into test_context(key, value)
select 'editable_one_time', (result->>'definition_id')::uuid from created;
select lives_ok(format(
  'select public.edit_benefit(%L::uuid, %L::jsonb, %L, null)',
  (select value from test_context where key = 'editable_one_time'),
  '{"notes":"Corrected without losing the first snapshot"}', 'current_and_future'
), 'a newly created first/current occurrence can be revisioned at its genuine boundary');
select is((select count(*) from public.benefit_definition_revisions
  where definition_id = (select value from test_context where key = 'editable_one_time')),
  2::bigint, 'first-occurrence edit preserves both immutable revision snapshots');
select is((select instance_version from public.benefit_instance_dashboard
  where definition_id = (select value from test_context where key = 'editable_one_time')
    and lifecycle_status <> 'void'), 2, 'first-occurrence edit creates a versioned live replacement');

select lives_ok(format(
  'select public.edit_benefit(%L::uuid, %L::jsonb, %L, null)',
  (select value from test_context where key = 'definition'),
  '{"benefit_amount":60}', 'future_periods'
), 'future edit revisions and reconciles without rewriting current history');

select is((
  select count(*) from public.benefit_definition_revisions r
  where r.definition_id = (select value from test_context where key = 'definition')
), 2::bigint, 'future edit closes one revision and creates one successor');
select is((
  select count(*) from public.benefit_definition_revisions r
  where r.definition_id = (select value from test_context where key = 'definition')
    and r.display_reset_date = current_date + 12
), 2::bigint, 'editing another field carries the display reset date through immutable revisions');
select is((
  select i.available_quantity from public.benefit_instances i
  where i.id = (select value from test_context where key = 'current_instance')
), 50.00::numeric, 'current historical period retains its original value');
select ok((
  select exists (
    select 1 from public.benefit_instances i
    where i.definition_id = (select value from test_context where key = 'definition')
      and i.period_start > current_date and i.voided_at is null and i.available_quantity = 60
  )
), 'future replacement uses successor revision value');
select ok((
  select i.voided_at is not null from public.benefit_instances i
  where i.id = (select value from test_context where key = 'future_instance')
), 'replaced future instance remains as a void audit version');
select ok((
  select d.is_audit_version and not d.is_live and d.void_reason is not null
    and d.superseded_by_instance_id is not null
  from public.benefit_instance_dashboard d
  where d.instance_id = (select value from test_context where key = 'future_instance')
), 'audit read model explicitly labels a voided version and its live successor');
select is((
  select count(*) from public.benefit_instance_overview d
  where d.instance_id = (select value from test_context where key = 'future_instance')
), 0::bigint, 'live operational overview excludes void audit versions');
select is((
  select count(*) from public.benefit_instance_overview d
  where d.definition_id = (select value from test_context where key = 'definition')
    and not d.is_live
), 0::bigint, 'every operational overview row is live by contract');

with redemption as (
  select (public.record_redemption(
    (select value from test_context where key = 'current_instance'),
    20, current_date, 'Test Merchant', 'Partial use', null
  )).id as id
)
insert into test_context(key, value) select 'redemption', id from redemption;

select is((
  select d.remaining_quantity from public.benefit_instance_dashboard d
  where d.instance_id = (select value from test_context where key = 'current_instance')
), 30.00::numeric, 'remaining balance is derived from redemption rows');
select is((
  select d.usage_status from public.benefit_instance_dashboard d
  where d.instance_id = (select value from test_context where key = 'current_instance')
), 'partial', 'partial usage is independently derived');

select throws_ok(format(
  'select public.record_redemption(%L::uuid, 31, current_date, null, null, null)',
  (select value from test_context where key = 'current_instance')
), '23514', 'redemption exceeds remaining quantity', 'finite over-redemption is rejected while holding the instance lock');

select lives_ok(format(
  'select public.edit_redemption(%L::uuid, 10, current_date, null, null, null)',
  (select value from test_context where key = 'redemption')
), 'redemption can be edited safely');
select is((
  select d.remaining_quantity from public.benefit_instance_dashboard d
  where d.instance_id = (select value from test_context where key = 'current_instance')
), 40.00::numeric, 'editing usage recalculates remaining balance');

select lives_ok(format(
  'select public.mark_finite_used(%L::uuid, current_date, null, null, null)',
  (select value from test_context where key = 'current_instance')
), 'mark used inserts the exact locked finite remainder');
select is((
  select d.usage_status from public.benefit_instance_dashboard d
  where d.instance_id = (select value from test_context where key = 'current_instance')
), 'used', 'mark used reaches the finite cap exactly');

select lives_ok(format(
  'select public.delete_redemption(%L::uuid)',
  (select value from test_context where key = 'redemption')
), 'an individual redemption can be deleted');
select is((
  select d.remaining_quantity from public.benefit_instance_dashboard d
  where d.instance_id = (select value from test_context where key = 'current_instance')
), 10.00::numeric, 'deleting one partial redemption restores only its amount');

select lives_ok(format(
  'select public.set_recurrence_enabled(%L::uuid, false)',
  (select value from test_context where key = 'definition')
), 'recurrence can be disabled without deleting history');
select ok(not (select recurrence_enabled from public.benefit_definitions
  where id = (select value from test_context where key = 'definition')), 'recurrence flag is disabled');
select ok((select count(*) > 0 from public.benefit_instances
  where definition_id = (select value from test_context where key = 'definition')
    and voided_at is not null), 'unstarted instances are voided for audit');
select lives_ok(format(
  'select public.set_recurrence_enabled(%L::uuid, true)',
  (select value from test_context where key = 'definition')
), 'recurrence re-enable generates from a genuine future boundary');

select lives_ok(format(
  'select public.set_benefit_active(%L::uuid, false)',
  (select value from test_context where key = 'definition')
), 'a benefit can be deactivated without deleting its history');
select ok(not (select active from public.benefit_definitions
  where id = (select value from test_context where key = 'definition')),
  'deactivation persists on the master definition');
select ok((select count(*) > 0 from public.benefit_instances
  where definition_id = (select value from test_context where key = 'definition')),
  'deactivation preserves historical and generated instances');
select lives_ok(format(
  'select public.set_benefit_active(%L::uuid, true)',
  (select value from test_context where key = 'definition')
), 'a deactivated benefit can be reactivated explicitly');
select ok((select active from public.benefit_definitions
  where id = (select value from test_context where key = 'definition')),
  'reactivation restores the active master state');

with created as (
  select public.create_benefit(jsonb_build_object(
    'name', 'pgTAP disposable future draft', 'category', 'Testing',
    'value_kind', 'money', 'benefit_amount', 15, 'currency', 'USD',
    'effective_date', current_date + 40, 'end_date', current_date + 45,
    'recurrence_type', 'one_time', 'recurrence_basis', 'none'
  )) as result
)
insert into test_context(key, value)
select 'future_draft', (result->>'definition_id')::uuid from created;
select ok(public.delete_benefit_draft(
  (select value from test_context where key = 'future_draft')
), 'an unreferenced future draft can be hard-deleted');
select is((select count(*) from public.benefit_definitions
  where id = (select value from test_context where key = 'future_draft')),
  0::bigint, 'draft deletion removes the definition and its generated draft instance');
select throws_ok(format(
  'select public.delete_benefit_draft(%L::uuid)',
  (select value from test_context where key = 'editable_one_time')
), '55000', 'only an unreferenced future draft may be hard-deleted; deactivate instead',
  'started benefit history cannot be hard-deleted');

with created as (
  select public.create_benefit(jsonb_build_object(
    'name', 'pgTAP missed enrollment', 'category', 'Testing',
    'value_kind', 'money', 'benefit_amount', 10, 'currency', 'USD',
    'effective_date', current_date, 'end_date', current_date + 40,
    'recurrence_type', 'one_time', 'recurrence_basis', 'none',
    'enrollment_required', true, 'enrollment_deadline', current_date - 1
  )) as result
)
insert into test_context(key, value)
select 'enrollment_missed', (result->>'definition_id')::uuid from created;
with created as (
  select public.create_benefit(jsonb_build_object(
    'name', 'pgTAP enrollment due seven', 'category', 'Testing',
    'value_kind', 'money', 'benefit_amount', 10, 'currency', 'USD',
    'effective_date', current_date, 'end_date', current_date + 40,
    'recurrence_type', 'one_time', 'recurrence_basis', 'none',
    'enrollment_required', true, 'enrollment_deadline', current_date + 7
  )) as result
)
insert into test_context(key, value)
select 'enrollment_due_seven', (result->>'definition_id')::uuid from created;
with created as (
  select public.create_benefit(jsonb_build_object(
    'name', 'pgTAP enrollment due thirty', 'category', 'Testing',
    'value_kind', 'money', 'benefit_amount', 10, 'currency', 'USD',
    'effective_date', current_date, 'end_date', current_date + 40,
    'recurrence_type', 'one_time', 'recurrence_basis', 'none',
    'enrollment_required', true, 'enrollment_deadline', current_date + 8
  )) as result
)
insert into test_context(key, value)
select 'enrollment_due_thirty', (result->>'definition_id')::uuid from created;

select ok((
  select d.enrollment_missed and not d.enrollment_due_7_days
    and not d.enrollment_due_30_days and d.enrollment_needs_attention
  from public.benefit_instance_overview d
  where d.definition_id = (select value from test_context where key = 'enrollment_missed')
), 'missed enrollment deadline is a distinct high-priority attention state');
select ok((
  select not d.enrollment_missed and d.enrollment_due_7_days
    and not d.enrollment_due_30_days and d.enrollment_due
  from public.benefit_instance_overview d
  where d.definition_id = (select value from test_context where key = 'enrollment_due_seven')
), 'enrollment deadline at seven days is in the near-term band');
select ok((
  select not d.enrollment_missed and not d.enrollment_due_7_days
    and d.enrollment_due_30_days and d.enrollment_needs_attention
  from public.benefit_instance_overview d
  where d.definition_id = (select value from test_context where key = 'enrollment_due_thirty')
), 'enrollment deadline at eight days is in the non-overlapping 8-to-30-day band');
select lives_ok(format(
  'select public.edit_benefit(%L::uuid, %L::jsonb, %L, null)',
  (select value from test_context where key = 'enrollment_missed'),
  jsonb_build_object('enrolled_at', current_date)::text,
  'current_and_future'
), 'marking enrollment is a mutable fulfillment-state update');
select ok((
  select not d.enrollment_missed and not d.enrollment_due_7_days
    and not d.enrollment_due_30_days and not d.enrollment_needs_attention
  from public.benefit_instance_overview d
  where d.definition_id = (select value from test_context where key = 'enrollment_missed')
), 'completed enrollment clears every attention band');

insert into test_context(key, value)
select 'uncapped_instance', i.id
from public.benefit_instances i
join public.benefit_definitions d on d.id = i.definition_id
where d.user_id = '11111111-1111-4111-8111-111111111111'
  and d.name = 'Sample uncapped portal offer' and i.voided_at is null
limit 1;
select lives_ok(format(
  'select public.record_redemption(%L::uuid, 5, current_date, null, null, null)',
  (select value from test_context where key = 'uncapped_instance')
), 'uncapped cashback records earned value without a fabricated cap');
select lives_ok(format(
  'select public.mark_uncapped_complete(%L::uuid, %L)',
  (select value from test_context where key = 'uncapped_instance'), 'Offer no longer needed'
), 'uncapped offer requires explicit completion');
select is((select usage_status from public.benefit_instance_dashboard
  where instance_id = (select value from test_context where key = 'uncapped_instance')),
  'used', 'explicit uncapped completion produces used status');

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}', true);
select is((
  select count(*) from public.benefit_definitions
  where id = (select value from test_context where key = 'definition')
), 0::bigint, 'a second owner cannot read the first owner definition');
select is((
  select count(*) from public.benefit_instance_dashboard
  where definition_id = (select value from test_context where key = 'definition')
), 0::bigint, 'security-invoker dashboard view preserves owner isolation');
select is((
  select count(*) from public.benefit_instance_overview
  where definition_id = (select value from test_context where key = 'definition')
), 0::bigint, 'security-invoker operational overview preserves owner isolation');
select is((select count(*) from public.accounts), 0::bigint, 'a second owner cannot read seeded owner accounts');

reset role;
select * from finish();
rollback;
