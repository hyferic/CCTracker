begin;
select plan(4);

select ok(
  exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'notification_type'
      and e.enumlabel = 'expiration_digest'
  ),
  'expiration digest notification type exists'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'notifications'
      and indexname = 'notifications_expiration_digest_day_idx'
  ),
  'digest events are unique per user and local day'
);

select ok(
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'schedule_expiration_digests'
  ),
  'daily digest scheduler helper exists'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgname = 'ensure_expiration_digest'
  ),
  'expiration notifications maintain a daily digest'
);

select * from finish();
rollback;
