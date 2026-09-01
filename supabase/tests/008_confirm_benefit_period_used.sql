begin;
set local timezone = 'America/New_York';
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select has_function('public', 'confirm_benefit_period_used', array['uuid', 'date', 'text'],
  'dashboard confirmation RPC is available');
select function_privs_are('public', 'confirm_benefit_period_used', array['uuid', 'date', 'text'],
  'authenticated', array['EXECUTE'],
  'dashboard confirmation RPC is executable by authenticated users');

select has_function('public', 'reopen_confirmed_benefit_period', array['uuid', 'uuid'],
  'explicit one-time correction RPC is available');
select function_privs_are('public', 'reopen_confirmed_benefit_period', array['uuid', 'uuid'],
  'authenticated', array['EXECUTE'],
  'one-time correction RPC is executable by authenticated users');

select has_column('public', 'benefit_instances', 'confirmation_manual_completion',
  'dashboard confirmation records whether it created the uncapped completion state');
select has_column('public', 'benefit_instances', 'confirmation_redemption_id',
  'dashboard confirmation records its bounded redemption identity');
select ok(
  position('Confirmed used from dashboard.' in pg_get_functiondef(
    'public.reopen_confirmed_benefit_period(uuid, uuid)'::regprocedure
  )) > 0,
  'reopen RPC retains the legacy dashboard-note compatibility path'
);

select * from finish();
rollback;
