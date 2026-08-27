-- Daily rolling expiration digest: one logical email per user and local day.
create unique index if not exists notifications_expiration_digest_day_idx
  on public.notifications(user_id, notification_type, eligibility_date)
  where notification_type = 'expiration_digest';

alter table public.notifications drop constraint if exists notifications_benefit_instance_id_notification_type_key;
create unique index if not exists notifications_instance_type_non_digest_idx
  on public.notifications(benefit_instance_id, notification_type)
  where notification_type <> 'expiration_digest';

create or replace function private.ensure_expiration_digest()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date;
  v_anchor uuid;
begin
  if new.notification_type <> 'expiration_7_day' then return new; end if;
  select (statement_timestamp() at time zone p.timezone)::date into v_today
  from public.profiles p where p.user_id = new.user_id and p.expiration_reminders_enabled;
  if v_today is null then return new; end if;
  select i.id into v_anchor
  from public.benefit_instances i
  join public.benefit_definitions d on d.id = i.definition_id and d.user_id = i.user_id
  join public.benefit_definition_revisions r
    on r.id = i.revision_id and r.definition_id = i.definition_id and r.user_id = i.user_id
  left join lateral (
    select coalesce(sum(rd.redeemed_quantity), 0) as redeemed
    from public.redemptions rd where rd.benefit_instance_id = i.id
  ) usage on true
  where i.user_id = new.user_id and i.voided_at is null and d.active
    and d.expiration_reminder_enabled and not i.expiration_notification_suppressed
    and i.period_end between v_today and v_today + 7
    and ((not i.is_uncapped and usage.redeemed < i.available_quantity)
      or (i.is_uncapped and i.manual_completed_at is null))
  order by i.period_end, i.id limit 1;
  if v_anchor is null then return new; end if;
  insert into public.notifications (
    benefit_instance_id, user_id, notification_type, scheduled_for, eligibility_date, state
  ) values (v_anchor, new.user_id, 'expiration_digest', statement_timestamp(), v_today, 'pending')
  on conflict (user_id, notification_type, eligibility_date)
    where notification_type = 'expiration_digest'
  do update set scheduled_for = least(public.notifications.scheduled_for, excluded.scheduled_for),
    state = case when public.notifications.first_attempt_at is null then 'pending'
      else public.notifications.state end
  where public.notifications.first_attempt_at is null
    and public.notifications.state <> 'superseded';
  return new;
end;
$$;

drop trigger if exists ensure_expiration_digest on public.notifications;
create trigger ensure_expiration_digest
after insert or update of scheduled_for, eligibility_date on public.notifications
for each row execute function private.ensure_expiration_digest();

revoke all on function private.ensure_expiration_digest() from public, anon, authenticated;
grant execute on function private.ensure_expiration_digest() to service_role;

create or replace function private.schedule_expiration_digests()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (
    benefit_instance_id, user_id, notification_type, scheduled_for, eligibility_date, state
  )
  select distinct on (i.user_id)
    i.id, i.user_id, 'expiration_digest', statement_timestamp(),
    (statement_timestamp() at time zone p.timezone)::date, 'pending'
  from public.benefit_instances i
  join public.benefit_definitions d on d.id = i.definition_id and d.user_id = i.user_id
  join public.benefit_definition_revisions r
    on r.id = i.revision_id and r.definition_id = i.definition_id and r.user_id = i.user_id
  join public.profiles p on p.user_id = i.user_id
  left join lateral (
    select coalesce(sum(rd.redeemed_quantity), 0) as redeemed
    from public.redemptions rd where rd.benefit_instance_id = i.id
  ) usage on true
  where i.voided_at is null and d.active and p.expiration_reminders_enabled
    and d.expiration_reminder_enabled and not i.expiration_notification_suppressed
    and i.period_end between (statement_timestamp() at time zone r.terms_timezone)::date
      and (statement_timestamp() at time zone r.terms_timezone)::date + 7
    and ((not i.is_uncapped and usage.redeemed < i.available_quantity)
      or (i.is_uncapped and i.manual_completed_at is null))
  order by i.user_id, i.period_end, i.id
  on conflict (user_id, notification_type, eligibility_date)
    where notification_type = 'expiration_digest'
  do update set scheduled_for = case
      when public.notifications.first_attempt_at is null then excluded.scheduled_for
      else public.notifications.scheduled_for end,
    state = case when public.notifications.first_attempt_at is null then 'pending'
      else public.notifications.state end
  where public.notifications.first_attempt_at is null
    and public.notifications.state <> 'superseded';
end;
$$;

revoke all on function private.schedule_expiration_digests() from public, anon, authenticated;
grant execute on function private.schedule_expiration_digests() to service_role;
create or replace function public.scheduler_prepare_work_legacy(
  p_job_run_id uuid,
  p_generation_month_limit integer default 24
)
returns table (
  generated_instances integer,
  scheduled_notifications integer,
  skipped_notifications integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_definition record;
  v_generated integer := 0;
  v_scheduled integer := 0;
  v_skipped integer := 0;
  v_rows integer;
  v_from date;
  v_through date;
begin
  if p_generation_month_limit < 1 or p_generation_month_limit > 24 then
    raise exception 'generation month limit must be between 1 and 24' using errcode = '22023';
  end if;
  if not exists (
    select 1 from private.job_runs j where j.id = p_job_run_id and j.status = 'running'
  ) then
    raise exception 'running job not found' using errcode = 'P0002';
  end if;

  for v_definition in
    select d.id, d.interval_months,
      latest.last_nominal_end,
      (statement_timestamp() at time zone p.timezone)::date as local_today
    from public.benefit_definitions d
    join public.profiles p on p.user_id = d.user_id
    left join lateral (
      select max(i.nominal_end) as last_nominal_end
      from public.benefit_instances i where i.definition_id = d.id
    ) latest on true
    where d.active and d.recurrence_enabled and d.recurrence_type <> 'one_time'
    order by d.id
  loop
    v_from := coalesce(
      v_definition.last_nominal_end + 1,
      (v_definition.local_today - make_interval(months => p_generation_month_limit))::date
    );
    v_through := greatest(
      v_definition.local_today + 31,
      (v_definition.local_today + make_interval(months => v_definition.interval_months))::date
    );
    if v_from <= v_through then
      v_generated := v_generated + private.materialize_definition(
        v_definition.id, v_from, v_through, 'scheduler', true, false
      );
    end if;
  end loop;

  -- Revive or create exactly one expiration event per live instance. Its logical
  -- identity is stable even when an unattempted expiry edit reschedules it.
  insert into public.notifications (
    benefit_instance_id, user_id, notification_type, scheduled_for,
    eligibility_date, state
  )
  select
    i.id,
    i.user_id,
    'expiration_7_day'::public.notification_type,
    ((i.period_end - 7)::timestamp at time zone p.timezone),
    i.period_end - 7,
    'pending'::public.notification_state
  from public.benefit_instances i
  join public.benefit_definitions d on d.id = i.definition_id and d.user_id = i.user_id
  join public.profiles p on p.user_id = i.user_id
  left join lateral (
    select coalesce(sum(r.redeemed_quantity), 0) as redeemed
    from public.redemptions r where r.benefit_instance_id = i.id
  ) usage on true
  where i.voided_at is null
    and d.active
    and p.expiration_reminders_enabled
    and d.expiration_reminder_enabled
    and not i.expiration_notification_suppressed
    and (statement_timestamp() at time zone p.timezone)::date <= i.period_end
    and (
      (not i.is_uncapped and usage.redeemed < i.available_quantity)
      or (i.is_uncapped and i.manual_completed_at is null)
    )
  on conflict (benefit_instance_id, notification_type)
    where notification_type <> 'expiration_digest' do update
    set scheduled_for = excluded.scheduled_for,
        eligibility_date = excluded.eligibility_date,
        state = 'pending',
        next_attempt_at = null,
        last_error = null,
        last_error_category = null
  where notifications.first_attempt_at is null
    and notifications.state <> 'superseded';
  get diagnostics v_rows = row_count;
  v_scheduled := v_scheduled + v_rows;

  insert into public.notifications (
    benefit_instance_id, user_id, notification_type, scheduled_for,
    eligibility_date, state
  )
  select
    i.id,
    i.user_id,
    'reactivation'::public.notification_type,
    (i.period_start::timestamp at time zone p.timezone),
    i.period_start,
    'pending'::public.notification_state
  from public.benefit_instances i
  join public.benefit_definitions d on d.id = i.definition_id and d.user_id = i.user_id
  join public.profiles p on p.user_id = i.user_id
  left join lateral (
    select coalesce(sum(r.redeemed_quantity), 0) as redeemed
    from public.redemptions r where r.benefit_instance_id = i.id
  ) usage on true
  where i.voided_at is null
    and i.reactivation_eligible
    and d.active
    and p.reactivation_reminders_enabled
    and d.reactivation_reminder_enabled
    and (statement_timestamp() at time zone p.timezone)::date <= i.period_end
    and (
      (not i.is_uncapped and usage.redeemed < i.available_quantity)
      or (i.is_uncapped and i.manual_completed_at is null)
    )
  on conflict (benefit_instance_id, notification_type)
    where notification_type <> 'expiration_digest' do update
    set scheduled_for = excluded.scheduled_for,
        eligibility_date = excluded.eligibility_date,
        state = 'pending',
        next_attempt_at = null,
        last_error = null,
        last_error_category = null
  where notifications.first_attempt_at is null
    and notifications.state <> 'superseded';
  get diagnostics v_rows = row_count;
  v_scheduled := v_scheduled + v_rows;

  -- Never mutate attempted event content. Only never-attempted work can become
  -- skipped and later be revived under the same unique logical identity.
  update public.notifications n
  set state = 'skipped', next_attempt_at = null
  where n.first_attempt_at is null
    and n.state <> 'superseded'
    and exists (
      select 1
      from public.benefit_instances i
      join public.benefit_definitions d on d.id = i.definition_id and d.user_id = i.user_id
      join public.profiles p on p.user_id = i.user_id
      left join lateral (
        select coalesce(sum(r.redeemed_quantity), 0) as redeemed
        from public.redemptions r where r.benefit_instance_id = i.id
      ) usage on true
      where i.id = n.benefit_instance_id
        and (
          i.voided_at is not null
          or not d.active
          or (statement_timestamp() at time zone p.timezone)::date > i.period_end
          or (n.notification_type = 'expiration_7_day' and (
            not p.expiration_reminders_enabled
            or not d.expiration_reminder_enabled
            or i.expiration_notification_suppressed
            or (not i.is_uncapped and usage.redeemed >= i.available_quantity)
            or (i.is_uncapped and i.manual_completed_at is not null)
          ))
          or (n.notification_type = 'reactivation' and (
            not i.reactivation_eligible
            or not p.reactivation_reminders_enabled
            or not d.reactivation_reminder_enabled
            or (not i.is_uncapped and usage.redeemed >= i.available_quantity)
            or (i.is_uncapped and i.manual_completed_at is not null)
          ))
        )
    );
  get diagnostics v_skipped = row_count;

  update private.job_runs j set
    heartbeat_at = statement_timestamp(),
    processing_local_date_min = dates.minimum_date,
    processing_local_date_max = dates.maximum_date,
    counts = j.counts || jsonb_build_object(
      'generated_instances', v_generated,
      'scheduled_notifications', v_scheduled,
      'skipped_notifications', v_skipped
    )
  from (
    select min((statement_timestamp() at time zone p.timezone)::date) as minimum_date,
           max((statement_timestamp() at time zone p.timezone)::date) as maximum_date
    from public.profiles p
  ) dates
  where j.id = p_job_run_id;

  generated_instances := v_generated;
  scheduled_notifications := v_scheduled;
  skipped_notifications := v_skipped;
  return next;
end;
$$;

create or replace function public.scheduler_prepare_work(
  p_job_run_id uuid,
  p_generation_month_limit integer default 24
)
returns table (
  generated_instances integer,
  scheduled_notifications integer,
  skipped_notifications integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_legacy record;
  v_definition record;
  v_rows integer := 0;
  v_new_rows integer := 0;
  v_generated integer := 0;
  v_from date;
  v_through date;
begin
  select * into v_legacy from public.scheduler_prepare_work_legacy(
    p_job_run_id, p_generation_month_limit);

  -- The pre-catalog scheduler uses the profile zone to choose its generation
  -- window. Fill any missing issuer-controlled periods using each active
  -- revision's terms zone. Unique occurrence constraints keep this idempotent.
  for v_definition in
    select d.id, d.interval_months, r.terms_timezone,
      latest.last_nominal_end,
      (statement_timestamp() at time zone r.terms_timezone)::date as terms_today
    from public.benefit_definitions d
    join public.benefit_definition_revisions r
      on r.definition_id = d.id and r.revision_no = d.current_revision_no
    left join lateral (
      select max(i.nominal_end) as last_nominal_end
      from public.benefit_instances i where i.definition_id = d.id and i.voided_at is null
    ) latest on true
    where d.active and d.recurrence_enabled and d.recurrence_type <> 'one_time'
    order by d.id
  loop
    v_from := coalesce(v_definition.last_nominal_end + 1,
      (v_definition.terms_today - make_interval(months => p_generation_month_limit))::date);
    v_through := greatest(v_definition.terms_today + 31,
      (v_definition.terms_today + make_interval(months => v_definition.interval_months))::date);
    if v_from <= v_through then
      v_generated := v_generated + private.materialize_definition(
        v_definition.id, v_from, v_through, 'scheduler', true, false);
    end if;
  end loop;

  -- Reconcile values/timezone eligibility even if this database session had an
  -- already-cached plan for the pre-catalog materializer before the migration.
  update public.benefit_instances i
  set available_quantity = coalesce(
        (select (rule->>'available_quantity')::numeric
         from jsonb_array_elements(r.period_value_rules) rule
         where (rule->>'calendar_month')::integer = extract(month from i.nominal_start)::integer),
        case when r.value_kind = 'percentage_cashback' then r.cashback_cap else r.benefit_amount end
      )
  from public.benefit_definition_revisions r
  where i.revision_id = r.id and i.voided_at is null;

  insert into public.notifications (
    benefit_instance_id, user_id, notification_type, scheduled_for, eligibility_date, state
  )
  select i.id, i.user_id, 'expiration_7_day'::public.notification_type,
    ((i.period_end - 7)::timestamp at time zone r.terms_timezone),
    i.period_end - 7, 'pending'::public.notification_state
  from public.benefit_instances i
  join public.benefit_definitions d on d.id = i.definition_id and d.user_id = i.user_id
  join public.benefit_definition_revisions r on r.id = i.revision_id
  join public.profiles p on p.user_id = i.user_id
  left join lateral (
    select coalesce(sum(rd.redeemed_quantity), 0) as redeemed
    from public.redemptions rd where rd.benefit_instance_id = i.id
  ) usage on true
  where i.voided_at is null and d.active and p.expiration_reminders_enabled
    and d.expiration_reminder_enabled and not i.expiration_notification_suppressed
    and (statement_timestamp() at time zone r.terms_timezone)::date <= i.period_end
    and ((not i.is_uncapped and usage.redeemed < i.available_quantity)
      or (i.is_uncapped and i.manual_completed_at is null))
  on conflict (benefit_instance_id, notification_type)
    where notification_type <> 'expiration_digest' do update
    set scheduled_for = excluded.scheduled_for, eligibility_date = excluded.eligibility_date,
      state = 'pending', next_attempt_at = null, last_error = null, last_error_category = null
  where notifications.first_attempt_at is null and notifications.state <> 'superseded';
  get diagnostics v_rows = row_count;

  insert into public.notifications (
    benefit_instance_id, user_id, notification_type, scheduled_for, eligibility_date, state
  )
  select i.id, i.user_id, 'reactivation'::public.notification_type,
    (i.period_start::timestamp at time zone r.terms_timezone),
    i.period_start, 'pending'::public.notification_state
  from public.benefit_instances i
  join public.benefit_definitions d on d.id = i.definition_id and d.user_id = i.user_id
  join public.benefit_definition_revisions r on r.id = i.revision_id
  join public.profiles p on p.user_id = i.user_id
  left join lateral (
    select coalesce(sum(rd.redeemed_quantity), 0) as redeemed
    from public.redemptions rd where rd.benefit_instance_id = i.id
  ) usage on true
  where i.voided_at is null and i.reactivation_eligible and d.active
    and p.reactivation_reminders_enabled and d.reactivation_reminder_enabled
    and (statement_timestamp() at time zone r.terms_timezone)::date <= i.period_end
    and ((not i.is_uncapped and usage.redeemed < i.available_quantity)
      or (i.is_uncapped and i.manual_completed_at is null))
  on conflict (benefit_instance_id, notification_type)
    where notification_type <> 'expiration_digest' do update
    set scheduled_for = excluded.scheduled_for, eligibility_date = excluded.eligibility_date,
      state = 'pending', next_attempt_at = null, last_error = null, last_error_category = null
  where notifications.first_attempt_at is null and notifications.state <> 'superseded';
  get diagnostics v_new_rows = row_count;
  v_rows := v_rows + v_new_rows;

  update public.notifications n set state = 'skipped', next_attempt_at = null
  from public.benefit_instances i
  join public.benefit_definition_revisions r on r.id = i.revision_id
  where n.benefit_instance_id = i.id and n.first_attempt_at is null
    and n.state <> 'superseded'
    and (statement_timestamp() at time zone r.terms_timezone)::date > i.period_end;
  get diagnostics v_new_rows = row_count;

  generated_instances := v_legacy.generated_instances + v_generated;
  scheduled_notifications := v_legacy.scheduled_notifications + v_rows;
  skipped_notifications := v_legacy.skipped_notifications + v_new_rows;
  perform private.schedule_expiration_digests();
  update private.job_runs j
  set counts = j.counts || jsonb_build_object(
    'generated_instances', generated_instances,
    'scheduled_notifications', scheduled_notifications,
    'skipped_notifications', skipped_notifications
  ), heartbeat_at = statement_timestamp()
  where j.id = p_job_run_id;
  return next;
end;
$$;

revoke all on function public.scheduler_prepare_work(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.scheduler_prepare_work(uuid, integer) to service_role;

create or replace function public.scheduler_claim_notifications(
  p_job_run_id uuid,
  p_batch_size integer default 25,
  p_lease_seconds integer default 900,
  p_from_email text default null
)
returns table (
  notification_id uuid,
  claim_token uuid,
  idempotency_key uuid,
  frozen_payload jsonb,
  frozen_payload_text text,
  payload_sha256 text,
  first_attempt_at timestamptz,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate record;
  v_claim uuid;
  v_key uuid;
  v_recipient text;
  v_subject text;
  v_text text;
  v_html text;
  v_payload jsonb;
  v_payload_text text;
  v_hash text;
  v_first timestamptz;
  v_attempt integer;
  v_remaining numeric;
  v_earned numeric;
  v_account text;
  v_days integer;
  v_digest_text text;
begin
  if p_batch_size < 1 or p_batch_size > 100 then
    raise exception 'batch size must be between 1 and 100' using errcode = '22023';
  end if;
  if p_lease_seconds < 60 or p_lease_seconds > 1800 then
    raise exception 'lease must be between 60 and 1800 seconds' using errcode = '22023';
  end if;
  if p_from_email is null or length(btrim(p_from_email)) not between 3 and 320 then
    raise exception 'from email is required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from private.job_runs j where j.id = p_job_run_id and j.status = 'running'
  ) then
    raise exception 'running job not found' using errcode = 'P0002';
  end if;

  with expired_claims as (
    update public.notifications n
    set state = case
        when statement_timestamp() >= n.first_attempt_at + interval '24 hours'
          then 'requires_review'::public.notification_state
        else 'ambiguous'::public.notification_state
      end,
      claim_token = null,
      claimed_at = null,
      lease_expires_at = null,
      next_attempt_at = case
        when statement_timestamp() >= n.first_attempt_at + interval '24 hours' then null
        else statement_timestamp()
      end,
      last_error_category = 'lease_expired',
      last_error = 'Previous claim lease expired before a durable outcome was recorded.'
    where n.state = 'processing'
      and n.lease_expires_at <= statement_timestamp()
    returning n.id, n.state
  )
  update private.notification_attempts a
  set finished_at = statement_timestamp(),
      outcome = e.state::text,
      error_category = 'lease_expired'
  from expired_claims e
  where a.notification_id = e.id and a.finished_at is null;

  update public.notifications n
  set state = 'requires_review', next_attempt_at = null,
      claim_token = null, claimed_at = null, lease_expires_at = null
  where n.state in ('retryable_failed', 'ambiguous')
    and n.first_attempt_at + interval '24 hours' <= statement_timestamp();

  for v_candidate in
    select
      n.id as notification_id,
      n.notification_type,
      n.first_attempt_at,
      n.attempt_count,
      n.idempotency_key,
      n.frozen_payload,
      n.frozen_payload_text,
      n.payload_sha256,
      i.id as instance_id,
      i.period_start,
      i.period_end,
      i.available_quantity,
      i.is_uncapped,
      i.currency,
      i.unit_label,
      i.manual_completed_at,
      r.name as benefit_name,
      r.notes,
      r.eligibility_notes,
      coalesce(a.display_name, a.issuer, 'Unassigned account') as account_name,
      lower(u.email) as recipient,
      (statement_timestamp() at time zone r.terms_timezone)::date as terms_today,
      coalesce(usage.redeemed, 0) as redeemed,
      digest.digest_text
    from public.notifications n
    join public.benefit_instances i
      on i.id = n.benefit_instance_id and i.user_id = n.user_id
    join public.benefit_definitions d
      on d.id = i.definition_id and d.user_id = i.user_id
    join public.benefit_definition_revisions r
      on r.id = i.revision_id and r.definition_id = i.definition_id and r.user_id = i.user_id
    join public.profiles p on p.user_id = i.user_id
    join auth.users u on u.id = i.user_id
      and u.email_confirmed_at is not null and u.email is not null
    left join public.accounts a on a.id = r.account_id and a.user_id = r.user_id
    left join lateral (
      select sum(redemption.redeemed_quantity) as redeemed
      from public.redemptions redemption where redemption.benefit_instance_id = i.id
    ) usage on true
    left join lateral (
      select string_agg(
        r2.name || ' · ' || coalesce(a2.display_name, a2.issuer, 'Unassigned account')
          || ' · expires ' || i2.period_end::text,
        E'\n' order by i2.period_end, r2.name
      ) as digest_text
      from public.benefit_instances i2
      join public.benefit_definitions d2
        on d2.id = i2.definition_id and d2.user_id = i2.user_id
      join public.benefit_definition_revisions r2
        on r2.id = i2.revision_id and r2.definition_id = i2.definition_id
        and r2.user_id = i2.user_id
      left join public.accounts a2 on a2.id = r2.account_id and a2.user_id = r2.user_id
      left join lateral (
        select coalesce(sum(redemption2.redeemed_quantity), 0) as redeemed
        from public.redemptions redemption2
        where redemption2.benefit_instance_id = i2.id
      ) usage2 on true
      where i2.user_id = n.user_id
        and i2.voided_at is null and d2.active
        and (statement_timestamp() at time zone r2.terms_timezone)::date
          between i2.period_start and i2.period_end
        and i2.period_end between
          (statement_timestamp() at time zone r2.terms_timezone)::date
          and (statement_timestamp() at time zone r2.terms_timezone)::date + 7
        and ((not i2.is_uncapped and usage2.redeemed < i2.available_quantity)
          or (i2.is_uncapped and i2.manual_completed_at is null))
        and not i2.expiration_notification_suppressed
        and d2.expiration_reminder_enabled
    ) digest on n.notification_type = 'expiration_digest'
    where n.state in ('pending', 'retryable_failed', 'ambiguous')
      and n.scheduled_for <= statement_timestamp()
      and (n.next_attempt_at is null or n.next_attempt_at <= statement_timestamp())
      and (n.first_attempt_at is null
        or n.first_attempt_at + interval '24 hours' > statement_timestamp())
      and i.voided_at is null
      and d.active
      and (
        (n.notification_type = 'expiration_digest' and digest.digest_text is not null
          and p.expiration_reminders_enabled and d.expiration_reminder_enabled
          and n.eligibility_date = (statement_timestamp() at time zone p.timezone)::date)
        or
        ((statement_timestamp() at time zone r.terms_timezone)::date
          between i.period_start and i.period_end)
      )
      and (
        (n.notification_type = 'expiration_digest')
        or
        (not i.is_uncapped and coalesce(usage.redeemed, 0) < i.available_quantity)
        or (i.is_uncapped and i.manual_completed_at is null)
      )
      and (
        (n.notification_type = 'expiration_digest'
          and p.expiration_reminders_enabled and d.expiration_reminder_enabled)
        or
        (n.notification_type = 'expiration_7_day'
          and p.expiration_reminders_enabled and d.expiration_reminder_enabled
          and not i.expiration_notification_suppressed)
        or
        (n.notification_type = 'reactivation'
          and p.reactivation_reminders_enabled and d.reactivation_reminder_enabled
          and i.reactivation_eligible
          and (statement_timestamp() at time zone r.terms_timezone)::date >= i.period_start)
      )
    order by n.scheduled_for, n.id
    for update of n, i skip locked
    limit p_batch_size
  loop
    v_claim := extensions.gen_random_uuid();
    v_first := coalesce(v_candidate.first_attempt_at, statement_timestamp());
    v_key := coalesce(v_candidate.idempotency_key, extensions.gen_random_uuid());
    v_attempt := v_candidate.attempt_count + 1;

    if v_candidate.first_attempt_at is null then
      v_recipient := v_candidate.recipient;
      v_account := v_candidate.account_name;
      v_earned := v_candidate.redeemed;
      v_remaining := case when v_candidate.is_uncapped then null
        else greatest(v_candidate.available_quantity - v_candidate.redeemed, 0) end;
      v_days := v_candidate.period_end - v_candidate.terms_today;

      if v_candidate.notification_type = 'expiration_digest' then
        v_digest_text := v_candidate.digest_text;
        v_subject := 'Benefits expiring in the next 7 days';
        v_text := 'Benefits expiring in the next 7 days:' || E'\n\n' || v_digest_text
          || E'\n\nConfirm usage in PerkLedger to stop future reminders.';
      elsif v_candidate.notification_type = 'expiration_7_day' then
        v_subject := 'Benefit expiring soon: ' || v_candidate.benefit_name;
        v_text := v_candidate.benefit_name || E'\nAccount/provider: ' || v_account
          || E'\nRemaining: ' || case when v_candidate.is_uncapped
            then 'Uncapped (earned to date: ' || v_earned::text || ' ' || v_candidate.unit_label || ')'
            else v_remaining::text || ' ' || v_candidate.unit_label end
          || E'\nExpiration date: ' || v_candidate.period_end::text
          || E'\nDays remaining: ' || v_days::text
          || case when coalesce(v_candidate.eligibility_notes, v_candidate.notes) is null then ''
            else E'\nNotes: ' || coalesce(v_candidate.eligibility_notes, v_candidate.notes) end;
      else
        v_subject := 'Benefit available again: ' || v_candidate.benefit_name;
        v_text := v_candidate.benefit_name || E'\nAccount/provider: ' || v_account
          || E'\nNew amount: ' || case when v_candidate.is_uncapped then 'Uncapped'
            else v_candidate.available_quantity::text || ' ' || v_candidate.unit_label end
          || E'\nBenefit period: ' || v_candidate.period_start::text || ' through '
          || v_candidate.period_end::text
          || E'\nExpiration date: ' || v_candidate.period_end::text;
      end if;

      v_html := '<p><strong>' || private.html_escape(v_candidate.benefit_name) || '</strong></p>'
        || '<p>' || replace(private.html_escape(v_text), E'\n', '<br>') || '</p>';
      v_payload := jsonb_build_object(
        'from', btrim(p_from_email),
        'to', jsonb_build_array(v_recipient),
        'subject', v_subject,
        'text', v_text,
        'html', v_html
      );
      v_payload_text := v_payload::text;
      v_hash := pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(v_payload_text, 'UTF8'), 'sha256'), 'hex');
    else
      v_payload := v_candidate.frozen_payload;
      v_payload_text := v_candidate.frozen_payload_text;
      v_hash := v_candidate.payload_sha256;
      v_recipient := null;
      v_subject := null;
      v_text := null;
      v_html := null;
    end if;

    update public.notifications n set
      state = 'processing',
      recipient = coalesce(n.recipient, v_recipient),
      subject = coalesce(n.subject, v_subject),
      rendered_text = coalesce(n.rendered_text, v_text),
      rendered_html = coalesce(n.rendered_html, v_html),
      frozen_payload = coalesce(n.frozen_payload, v_payload),
      frozen_payload_text = coalesce(n.frozen_payload_text, v_payload_text),
      payload_sha256 = coalesce(n.payload_sha256, v_hash),
      idempotency_key = coalesce(n.idempotency_key, v_key),
      first_attempt_at = coalesce(n.first_attempt_at, v_first),
      attempt_count = v_attempt,
      claim_token = v_claim,
      claimed_at = statement_timestamp(),
      lease_expires_at = statement_timestamp() + make_interval(secs => p_lease_seconds),
      next_attempt_at = null,
      last_error = null,
      last_error_category = null
    where n.id = v_candidate.notification_id;

    insert into private.notification_attempts (
      notification_id, job_run_id, attempt_no, claim_token
    ) values (v_candidate.notification_id, p_job_run_id, v_attempt, v_claim);

    notification_id := v_candidate.notification_id;
    claim_token := v_claim;
    idempotency_key := v_key;
    frozen_payload := v_payload;
    frozen_payload_text := v_payload_text;
    payload_sha256 := v_hash;
    first_attempt_at := v_first;
    attempt_count := v_attempt;
    return next;
  end loop;

  update private.job_runs j set heartbeat_at = statement_timestamp()
  where j.id = p_job_run_id;
end;
$$;

revoke all on function public.scheduler_claim_notifications(uuid, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.scheduler_claim_notifications(uuid, integer, integer, text)
  to service_role;
