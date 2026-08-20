begin;

-- Keep fixture current_date aligned with the owner's configured business date.
set local timezone = 'America/New_York';

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

update public.benefit_definitions
set expiration_reminder_enabled = false, reactivation_reminder_enabled = false
where user_id = '11111111-1111-4111-8111-111111111111';

create temporary table scheduler_context (key text primary key, value uuid);
create temporary table scheduler_claims (
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
grant all on table scheduler_context, scheduler_claims to authenticated, service_role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

with created as (
  select public.create_benefit(jsonb_build_object(
    'account_id', '22222222-2222-4222-8222-222222222222',
    'name', 'pgTAP expires in seven days',
    'category', 'Testing',
    'notes', 'Reminder contract fixture',
    'value_kind', 'money',
    'benefit_amount', 25,
    'currency', 'USD',
    'effective_date', current_date,
    'end_date', current_date + 7,
    'recurrence_type', 'one_time',
    'recurrence_basis', 'none'
  )) as result
)
insert into scheduler_context(key, value)
select 'definition', (result->>'definition_id')::uuid from created;

insert into scheduler_context(key, value)
select 'instance', i.id from public.benefit_instances i
where i.definition_id = (select value from scheduler_context where key = 'definition')
  and i.voided_at is null;

reset role;
set local role service_role;
insert into scheduler_context(key, value)
values ('job', public.scheduler_begin_run('test'));

select lives_ok(format(
  'select * from public.scheduler_prepare_work(%L::uuid, 24)',
  (select value from scheduler_context where key = 'job')
), 'scheduler prepares recurrence and candidates in a bounded transaction');
select lives_ok(format(
  'select * from public.scheduler_prepare_work(%L::uuid, 24)',
  (select value from scheduler_context where key = 'job')
), 'repeated preparation is idempotent');

reset role;
select is((
  select count(*) from public.notifications n
  where n.benefit_instance_id = (select value from scheduler_context where key = 'instance')
    and n.notification_type = 'expiration_7_day'
), 1::bigint, 'duplicate schedule passes create one logical expiration event');
select is((
  select n.eligibility_date from public.notifications n
  where n.benefit_instance_id = (select value from scheduler_context where key = 'instance')
    and n.notification_type = 'expiration_7_day'
), current_date, 'exact seven-day event is eligible on the expected local date');

set local role service_role;
insert into scheduler_claims
select 1, c.* from public.scheduler_claim_notifications(
  (select value from scheduler_context where key = 'job'), 10, 900,
  'benefits@example.test'
) c;
reset role;

select is((select count(*) from scheduler_claims where sequence = 1), 1::bigint, 'one due event is claimed once');
select ok((select frozen_payload ?& array['from','to','subject','text','html']
  from scheduler_claims where sequence = 1), 'first claim freezes a complete Resend payload');
select is((select frozen_payload->'to'->>0 from scheduler_claims where sequence = 1),
  'owner@example.test', 'claim recipient is the confirmed authentication email');
select is((
  select pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(frozen_payload_text, 'UTF8'), 'sha256'), 'hex'
  ) from scheduler_claims where sequence = 1
), (select payload_sha256 from scheduler_claims where sequence = 1),
  'payload SHA-256 covers the exact serialized bytes returned to Edge');
select ok(position('Benefit expiring soon:' in
  (select frozen_payload_text from scheduler_claims where sequence = 1)) > 0,
  'frozen payload contains the expiration subject');
select is((select attempt_count from scheduler_claims where sequence = 1), 1, 'first claim records attempt one');

select throws_ok(format(
  'update public.notifications set subject = %L where id = %L::uuid',
  'mutated after claim', (select notification_id from scheduler_claims where sequence = 1)
), '55000', 'attempted notification payload and idempotency identity are immutable',
  'attempted content cannot be edited even by a privileged writer');

set local role service_role;
select ok(public.scheduler_record_notification_outcome(
  (select notification_id from scheduler_claims where sequence = 1),
  (select claim_token from scheduler_claims where sequence = 1),
  'retryable_failed', null, 'provider_500', 'Temporary provider error'
), 'retryable result is accepted only with the live claim token');
reset role;

select is((select state::text from public.notifications
  where id = (select notification_id from scheduler_claims where sequence = 1)),
  'retryable_failed', 'retryable provider response remains eligible for bounded retry');
select ok((select next_attempt_at > first_attempt_at from public.notifications
  where id = (select notification_id from scheduler_claims where sequence = 1)),
  'retryable outcome schedules a later attempt');

update public.notifications set next_attempt_at = statement_timestamp() - interval '1 second'
where id = (select notification_id from scheduler_claims where sequence = 1);

set local role service_role;
insert into scheduler_claims
select 2, c.* from public.scheduler_claim_notifications(
  (select value from scheduler_context where key = 'job'), 10, 900,
  'benefits@example.test'
) c;
reset role;

select is((select idempotency_key from scheduler_claims where sequence = 2),
  (select idempotency_key from scheduler_claims where sequence = 1),
  'retry uses the same provider idempotency key');
select is((select frozen_payload_text from scheduler_claims where sequence = 2),
  (select frozen_payload_text from scheduler_claims where sequence = 1),
  'retry returns byte-identical frozen provider content');
select is((select attempt_count from scheduler_claims where sequence = 2), 2,
  'retry increments the durable attempt count');

set local role service_role;
select ok(public.scheduler_record_notification_outcome(
  (select notification_id from scheduler_claims where sequence = 2),
  (select claim_token from scheduler_claims where sequence = 2),
  'provider_accepted', 'resend-test-message-id', null, null
), 'provider acceptance is durably recorded');
select ok(not public.scheduler_record_notification_outcome(
  (select notification_id from scheduler_claims where sequence = 2),
  (select claim_token from scheduler_claims where sequence = 2),
  'provider_accepted', 'duplicate', null, null
), 'a consumed claim token cannot record a second outcome');
reset role;

select is((select state::text from public.notifications
  where id = (select notification_id from scheduler_claims where sequence = 1)),
  'provider_accepted', 'accepted means provider accepted, not inbox delivered');
select is((select delivery_state::text from public.notifications
  where id = (select notification_id from scheduler_claims where sequence = 1)),
  'unknown', 'delivery remains unknown without a webhook');
select is((select count(*) from private.notification_attempts
  where notification_id = (select notification_id from scheduler_claims where sequence = 1)),
  2::bigint, 'private attempt audit records both tries without duplicating bodies');

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
with created as (
  select public.create_benefit(jsonb_build_object(
    'account_id', '22222222-2222-4222-8222-222222222222',
    'name', 'pgTAP recurring reactivation',
    'category', 'Testing',
    'value_kind', 'money',
    'benefit_amount', 15,
    'currency', 'USD',
    'effective_date', date_trunc('month', current_date)::date,
    'recurrence_type', 'monthly',
    'recurrence_basis', 'calendar',
    'interval_months', 1,
    'expiration_reminder_enabled', false,
    'reactivation_reminder_enabled', true
  )) as result
)
insert into scheduler_context(key, value)
select 'reactivation_definition', (result->>'definition_id')::uuid from created;

reset role;
update public.benefit_instances i
set reactivation_eligible = true
where i.definition_id = (select value from scheduler_context where key = 'reactivation_definition')
  and current_date between i.period_start and i.period_end
  and i.voided_at is null;
insert into scheduler_context(key, value)
select 'reactivation_instance', i.id
from public.benefit_instances i
where i.definition_id = (select value from scheduler_context where key = 'reactivation_definition')
  and current_date between i.period_start and i.period_end
  and i.voided_at is null;

set local role service_role;
select lives_ok(format(
  'select * from public.scheduler_prepare_work(%L::uuid, 24)',
  (select value from scheduler_context where key = 'job')
), 'scheduler creates the recurring-reactivation candidate');
select lives_ok(format(
  'select * from public.scheduler_prepare_work(%L::uuid, 24)',
  (select value from scheduler_context where key = 'job')
), 'duplicate reactivation preparation is idempotent');
reset role;

select is((
  select count(*) from public.notifications n
  where n.benefit_instance_id = (select value from scheduler_context where key = 'reactivation_instance')
    and n.notification_type = 'reactivation'
), 1::bigint, 'duplicate scheduler passes create one logical reactivation event');

set local role service_role;
insert into scheduler_claims
select 3, c.* from public.scheduler_claim_notifications(
  (select value from scheduler_context where key = 'job'), 10, 180,
  'benefits@example.test'
) c;
reset role;

select is((select count(*) from scheduler_claims where sequence = 3), 1::bigint,
  'the due recurring reactivation event is claimed exactly once');
select is((
  select n.notification_type::text
  from public.notifications n
  where n.id = (select notification_id from scheduler_claims where sequence = 3)
), 'reactivation', 'the claimed event has reactivation identity');
select like((select frozen_payload_text from scheduler_claims where sequence = 3),
  '%Benefit available again:%', 'reactivation freezes the available-again email payload');
select is((
  select extract(epoch from (n.lease_expires_at - n.claimed_at))::integer
  from public.notifications n
  where n.id = (select notification_id from scheduler_claims where sequence = 3)
), 180, 'claim lease safely exceeds the bounded 110-second processor runtime');

-- Simulate a provider/client disconnect: the send attempt remains processing,
-- its caller disappears, and the durable lease later expires.
update public.notifications n
set claimed_at = statement_timestamp() - interval '4 minutes',
    lease_expires_at = statement_timestamp() - interval '1 minute'
where n.id = (select notification_id from scheduler_claims where sequence = 3);

set local role service_role;
insert into scheduler_claims
select 31, c.* from public.scheduler_claim_notifications(
  (select value from scheduler_context where key = 'job'), 10, 180,
  'benefits@example.test'
) c;
reset role;

select is((select count(*) from scheduler_claims where sequence = 31), 1::bigint,
  'an expired processing lease is reclaimed exactly once');
select isnt((select claim_token from scheduler_claims where sequence = 31),
  (select claim_token from scheduler_claims where sequence = 3),
  'lease recovery rotates the database claim token');
select is((select idempotency_key from scheduler_claims where sequence = 31),
  (select idempotency_key from scheduler_claims where sequence = 3),
  'lease recovery retains the provider idempotency key');
select is((select frozen_payload_text from scheduler_claims where sequence = 31),
  (select frozen_payload_text from scheduler_claims where sequence = 3),
  'lease recovery retains byte-identical provider content');
select is((select attempt_count from scheduler_claims where sequence = 31), 2,
  'lease recovery records a second bounded attempt');
select is((
  select a.outcome from private.notification_attempts a
  where a.notification_id = (select notification_id from scheduler_claims where sequence = 3)
    and a.attempt_no = 1
), 'ambiguous', 'expired lease closes the prior attempt as ambiguous');
select ok((
  select a.finished_at is not null and a.error_category = 'lease_expired'
  from private.notification_attempts a
  where a.notification_id = (select notification_id from scheduler_claims where sequence = 3)
    and a.attempt_no = 1
), 'expired lease leaves a durable recovery audit record');

set local role service_role;
select ok(not public.scheduler_record_notification_outcome(
  (select notification_id from scheduler_claims where sequence = 3),
  (select claim_token from scheduler_claims where sequence = 3),
  'provider_accepted', 'late-stale-provider-message-id', null, null
), 'a late response from the timed-out client cannot consume the replacement claim');
select ok(public.scheduler_record_notification_outcome(
  (select notification_id from scheduler_claims where sequence = 31),
  (select claim_token from scheduler_claims where sequence = 31),
  'provider_accepted', 'resend-reactivation-message-id', null, null
), 'reactivation provider acceptance is durable');
select lives_ok(format(
  'select * from public.scheduler_prepare_work(%L::uuid, 24)',
  (select value from scheduler_context where key = 'job')
), 'scheduler safely revisits an accepted reactivation event');
insert into scheduler_claims
select 4, c.* from public.scheduler_claim_notifications(
  (select value from scheduler_context where key = 'job'), 10, 900,
  'benefits@example.test'
) c;
reset role;

select is((select count(*) from scheduler_claims where sequence = 4), 0::bigint,
  'an accepted reactivation is not claimed again after another scheduler pass');
select is((
  select count(*) from public.notifications n
  where n.benefit_instance_id = (select value from scheduler_context where key = 'reactivation_instance')
    and n.notification_type = 'reactivation'
), 1::bigint, 'reactivation deduplication remains stable after provider acceptance');

set local role service_role;
select ok(public.scheduler_heartbeat(
  (select value from scheduler_context where key = 'job'), '{"claimed":4}'::jsonb
), 'running job heartbeat is updateable');
select ok(public.scheduler_finish_run(
  (select value from scheduler_context where key = 'job'), 'succeeded',
  '{"accepted":2}'::jsonb, null
), 'job finishes with a sanitized aggregate status');
select ok((select database_ready from public.scheduler_system_health()),
  'service-only health confirms database readiness');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select is((select last_status from public.scheduler_health()), 'succeeded',
  'owner health exposes the last aggregate run status');
select ok(not (select is_stale from public.scheduler_health()),
  'fresh scheduler heartbeat is not marked stale');

reset role;
select * from finish();
rollback;
