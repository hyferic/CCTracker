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

select * from finish();
rollback;
