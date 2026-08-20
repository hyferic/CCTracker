-- Foundation extensions, private namespace, and deliberately small domain enums.
create schema if not exists extensions;
create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists supabase_vault with schema vault;

create type public.benefit_value_kind as enum (
  'money',
  'percentage_cashback',
  'points',
  'membership',
  'other'
);

create type public.benefit_recurrence_type as enum (
  'one_time',
  'monthly',
  'quarterly',
  'semiannual',
  'annual',
  'custom'
);

create type public.benefit_recurrence_basis as enum (
  'none',
  'calendar',
  'anniversary'
);

create type public.instance_source as enum (
  'creation',
  'scheduler',
  'backfill',
  'import',
  'regeneration',
  're_enable'
);

create type public.notification_type as enum (
  'expiration_7_day',
  'reactivation'
);

create type public.notification_state as enum (
  'pending',
  'processing',
  'provider_accepted',
  'definitive_failed',
  'retryable_failed',
  'ambiguous',
  'skipped',
  'superseded',
  'requires_review'
);

create type public.notification_delivery_state as enum (
  'unknown',
  'delivered',
  'bounced',
  'complained'
);

create type private.job_run_status as enum (
  'running',
  'succeeded',
  'partial_failure',
  'failed'
);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated;
