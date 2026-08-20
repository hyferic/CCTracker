begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'accounts', 'accounts exists');
select has_table('public', 'benefit_definitions', 'benefit definitions exist');
select has_table('public', 'benefit_definition_revisions', 'immutable revisions exist');
select has_table('public', 'benefit_instances', 'period instances exist');
select has_table('public', 'redemptions', 'redemptions exist');
select has_table('public', 'notifications', 'notification state exists');
select has_table('private', 'job_runs', 'private job runs exist');
select has_view('public', 'benefit_instance_dashboard', 'dashboard aggregate view exists');
select has_view('public', 'benefit_instance_overview', 'live-only operational overview exists');

select col_type_is('public', 'benefit_instances', 'period_start', 'date', 'period dates are date-only');
select col_type_is('public', 'benefit_instances', 'available_quantity', 'numeric(14,2)', 'finite values are two decimal numeric');
select col_type_is('public', 'notifications', 'scheduled_for', 'timestamp with time zone', 'notification schedule is an instant');
select has_column('public', 'notifications', 'frozen_payload_text', 'exact serialized provider body is stored');
select has_column('public', 'notifications', 'payload_sha256', 'frozen body hash is stored');
select has_column('public', 'benefit_definition_revisions', 'business_snapshot', 'revision snapshot exists');
select has_column('public', 'benefit_definition_revisions', 'display_reset_date',
  'reset display date is retained in immutable revisions');
select has_column('public', 'benefit_instance_dashboard', 'enrollment_missed',
  'dashboard derives missed enrollment attention');
select has_column('public', 'benefit_instance_dashboard', 'is_audit_version',
  'dashboard explicitly labels void audit versions');

select ok((
  select a.attgenerated = 's'
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'benefit_definition_revisions'
    and a.attname = 'business_snapshot'
), 'business snapshot is a stored generated column');

select ok((
  select c.relrowsecurity and c.relforcerowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'benefit_instances'
), 'benefit instances enable and force RLS');

select ok((
  select 'security_invoker=true' = any(coalesce(c.reloptions, '{}'::text[]))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'benefit_instance_dashboard'
), 'dashboard view invokes underlying RLS');
select ok((
  select 'security_invoker=true' = any(coalesce(c.reloptions, '{}'::text[]))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'benefit_instance_overview'
), 'live-only overview invokes underlying RLS');

select ok(has_table_privilege('authenticated', 'public.accounts', 'SELECT'), 'authenticated may select accounts');
select ok(has_table_privilege('authenticated', 'public.benefit_instance_overview', 'SELECT'),
  'authenticated may select the live-only overview');
select ok(has_table_privilege('authenticated', 'public.accounts', 'INSERT'), 'authenticated may insert accounts');
select ok(not has_table_privilege('authenticated', 'public.benefit_definitions', 'INSERT'), 'definitions cannot be inserted directly');
select ok(not has_table_privilege('anon', 'public.accounts', 'SELECT'), 'anonymous role cannot read accounts');
select ok(not has_schema_privilege('authenticated', 'private', 'USAGE'), 'authenticated role cannot use private schema');

select ok(has_function_privilege('authenticated', 'public.create_benefit(jsonb,integer)', 'EXECUTE'), 'authenticated can call create lifecycle RPC');
select ok(not has_function_privilege('anon', 'public.create_benefit(jsonb,integer)', 'EXECUTE'), 'anonymous cannot call create lifecycle RPC');
select ok(not has_function_privilege('authenticated', 'public.scheduler_begin_run(text)', 'EXECUTE'), 'browser session cannot start scheduler');
select ok(has_function_privilege('service_role', 'public.scheduler_begin_run(text)', 'EXECUTE'), 'service role can start scheduler');
select ok(not has_function_privilege('authenticated', 'public.scheduler_system_health()', 'EXECUTE'), 'system health is service-only');

select is((
  select count(*) from pg_policies
  where schemaname = 'public' and tablename = 'notifications'
    and roles @> array['authenticated'::name]
), 1::bigint, 'notifications have only an owner read policy');

select is((
  select count(*) from pg_indexes
  where schemaname = 'public' and indexname = 'benefit_instance_one_live_occurrence'
), 1::bigint, 'partial live occurrence uniqueness is installed');

select is((
  select count(*) from pg_constraint
  where conname in ('benefit_revision_ranges_do_not_overlap', 'benefit_instance_live_ranges_do_not_overlap')
    and contype = 'x'
), 2::bigint, 'revision and live-period exclusion constraints exist');

select ok((
  select array_agg(e.enumlabel::text order by e.enumsortorder) @>
    array['pending','processing','provider_accepted','definitive_failed','retryable_failed',
      'ambiguous','skipped','superseded','requires_review']::text[]
  from pg_enum e join pg_type t on t.oid = e.enumtypid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' and t.typname = 'notification_state'
), 'notification state machine contains every approved state');

select is(private.anchor_add_months('2027-01-31'::date, 1), '2027-02-28'::date,
  'January 31 clamps to non-leap February end');
select is(private.anchor_add_months('2028-01-31'::date, 1), '2028-02-29'::date,
  'January 31 clamps to leap February end');
select is(private.anchor_add_months('2027-01-31'::date, 2), '2027-03-31'::date,
  'original January 31 anchor returns to March 31 without drift');
select is(private.anchor_add_months('2027-02-28'::date, 12), '2028-02-29'::date,
  'a non-leap February end remains end-of-month in a leap year');
select is(private.anchor_add_months('2024-02-29'::date, 12), '2025-02-28'::date,
  'leap-day annual recurrence clamps in a non-leap year');
select is(private.anchor_add_months('2024-02-29'::date, 48), '2028-02-29'::date,
  'leap-day annual recurrence returns to February 29 in a leap year');
select is(private.anchor_add_months('2027-04-30'::date, 1), '2027-05-31'::date,
  'April 30 original month-end advances to May 31');
select is(private.anchor_add_months('2027-04-30'::date, 2), '2027-06-30'::date,
  'April 30 month-end advances to June end from the original anchor');
select is(private.anchor_add_months('2027-08-31'::date, 1), '2027-09-30'::date,
  'August 31 clamps into a 30-day month');
select is(private.anchor_add_months('2027-08-31'::date, 2), '2027-10-31'::date,
  'August 31 returns to October 31 without drift');
select is(private.anchor_add_months('2027-11-30'::date, 1), '2027-12-31'::date,
  'November 30 month-end advances to December 31');
select is(private.anchor_add_months('2027-12-31'::date, 1), '2028-01-31'::date,
  'month-end anchoring crosses December to January');
select is(private.anchor_add_months('2027-05-30'::date, 2), '2027-07-30'::date,
  'a non-month-end day 30 remains day 30 rather than drifting to month end');
select is(private.anchor_add_months('2027-03-31'::date, -1), '2027-02-28'::date,
  'month-end semantics also hold for negative offsets');
select is(private.calendar_bucket_start('quarterly', '2027-05-31'::date), '2027-04-01'::date,
  'calendar quarter uses the January/April/July/October boundaries');
select is(private.calendar_bucket_start('semiannual', '2027-12-31'::date), '2027-07-01'::date,
  'calendar semiannual period uses the July boundary');
select is(private.calendar_bucket_start('annual', '2028-01-01'::date), '2028-01-01'::date,
  'annual calendar recurrence crosses December to January safely');
select is(
  ('2027-03-14'::date::timestamp at time zone 'America/New_York'),
  '2027-03-14 05:00:00+00'::timestamptz,
  'local midnight is converted explicitly before the DST transition'
);
select is(
  ('2027-03-15'::date::timestamp at time zone 'America/New_York'),
  '2027-03-15 04:00:00+00'::timestamptz,
  'local midnight conversion follows the post-DST offset'
);

select ok((
  select position('timeout_milliseconds := 120000' in
    pg_get_functiondef('private.install_notification_cron()'::regprocedure)) > 0
), 'Cron HTTP timeout exceeds the bounded 110-second Edge processor runtime');

select is((
  select count(*) from pg_constraint c
  join pg_class r on r.oid = c.conrelid
  join pg_namespace n on n.oid = r.relnamespace
  where n.nspname = 'public' and r.relname = 'profiles'
    and c.conname = 'profiles_notification_email_shape' and c.contype = 'c'
), 1::bigint, 'notification recipient shape has an authoritative database constraint');

select * from finish();
rollback;
