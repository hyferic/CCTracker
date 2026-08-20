-- Service-role-only generation, notification selection, byte-frozen claims, and run health.

create or replace function private.html_escape(p_value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select replace(replace(replace(replace(replace(coalesce(p_value, ''),
    '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;');
$$;

revoke all on function private.html_escape(text) from public, anon, authenticated;

create or replace function public.scheduler_begin_run(p_trigger text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_trigger not in ('cron', 'manual_recovery', 'test') then
    raise exception 'unsupported scheduler trigger' using errcode = '22023';
  end if;
  insert into private.job_runs(trigger_source) values (p_trigger) returning id into v_id;
  return v_id;
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
  on conflict (benefit_instance_id, notification_type) do update
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
  on conflict (benefit_instance_id, notification_type) do update
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
  if not exists (select 1 from private.job_runs j where j.id = p_job_run_id and j.status = 'running') then
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
      (statement_timestamp() at time zone p.timezone)::date as local_today,
      coalesce(usage.redeemed, 0) as redeemed
    from public.notifications n
    join public.benefit_instances i on i.id = n.benefit_instance_id and i.user_id = n.user_id
    join public.benefit_definitions d on d.id = i.definition_id and d.user_id = i.user_id
    join public.benefit_definition_revisions r
      on r.id = i.revision_id and r.definition_id = i.definition_id and r.user_id = i.user_id
    join public.profiles p on p.user_id = i.user_id
    join auth.users u on u.id = i.user_id
      and u.email_confirmed_at is not null
      and u.email is not null
    left join public.accounts a on a.id = r.account_id and a.user_id = r.user_id
    left join lateral (
      select sum(r.redeemed_quantity) as redeemed
      from public.redemptions r where r.benefit_instance_id = i.id
    ) usage on true
    where n.state in ('pending', 'retryable_failed', 'ambiguous')
      and n.scheduled_for <= statement_timestamp()
      and (n.next_attempt_at is null or n.next_attempt_at <= statement_timestamp())
      and (n.first_attempt_at is null or n.first_attempt_at + interval '24 hours' > statement_timestamp())
      and i.voided_at is null
      and d.active
      and (statement_timestamp() at time zone p.timezone)::date between i.period_start and i.period_end
      and (
        (not i.is_uncapped and coalesce(usage.redeemed, 0) < i.available_quantity)
        or (i.is_uncapped and i.manual_completed_at is null)
      )
      and (
        (n.notification_type = 'expiration_7_day'
          and p.expiration_reminders_enabled and d.expiration_reminder_enabled
          and not i.expiration_notification_suppressed)
        or
        (n.notification_type = 'reactivation'
          and p.reactivation_reminders_enabled and d.reactivation_reminder_enabled
          and i.reactivation_eligible
          and (statement_timestamp() at time zone p.timezone)::date >= i.period_start)
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
      v_days := v_candidate.period_end - v_candidate.local_today;

      if v_candidate.notification_type = 'expiration_7_day' then
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
          || E'\nBenefit period: ' || v_candidate.period_start::text || ' through ' || v_candidate.period_end::text
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
        extensions.digest(pg_catalog.convert_to(v_payload_text, 'UTF8'), 'sha256'),
        'hex'
      );
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

create or replace function public.scheduler_record_notification_outcome(
  p_notification_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_provider_message_id text default null,
  p_error_category text default null,
  p_error_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notification public.notifications%rowtype;
  v_state public.notification_state;
  v_next timestamptz;
  v_now timestamptz := statement_timestamp();
begin
  if p_outcome not in ('provider_accepted', 'definitive_failed', 'retryable_failed', 'ambiguous') then
    raise exception 'unsupported notification outcome' using errcode = '22023';
  end if;
  select * into v_notification from public.notifications n
  where n.id = p_notification_id and n.claim_token = p_claim_token and n.state = 'processing'
  for update;
  if not found then return false; end if;

  if p_outcome = 'provider_accepted' then
    if nullif(btrim(p_provider_message_id), '') is null then
      raise exception 'provider message ID is required for acceptance' using errcode = '22023';
    end if;
    v_state := 'provider_accepted';
  elsif p_outcome = 'definitive_failed' then
    v_state := 'definitive_failed';
  elsif v_now >= v_notification.first_attempt_at + interval '24 hours'
        or v_notification.attempt_count >= 6 then
    v_state := 'requires_review';
  else
    v_state := p_outcome::public.notification_state;
    v_next := v_notification.first_attempt_at + case v_notification.attempt_count
      when 1 then interval '15 minutes'
      when 2 then interval '1 hour'
      when 3 then interval '4 hours'
      when 4 then interval '12 hours'
      else interval '23 hours'
    end;
    if v_next <= v_now then v_next := v_now; end if;
  end if;

  update public.notifications n set
    state = v_state,
    provider_message_id = case when v_state = 'provider_accepted'
      then left(btrim(p_provider_message_id), 500) else n.provider_message_id end,
    provider_accepted_at = case when v_state = 'provider_accepted' then v_now else n.provider_accepted_at end,
    last_error_category = case when v_state = 'provider_accepted' then null
      else left(regexp_replace(coalesce(p_error_category, 'unknown'), '[\r\n\t]+', ' ', 'g'), 100) end,
    last_error = case when v_state = 'provider_accepted' then null
      else left(regexp_replace(coalesce(p_error_message, 'No provider detail.'), '[\r\n\t]+', ' ', 'g'), 2000) end,
    next_attempt_at = case when v_state in ('retryable_failed', 'ambiguous') then v_next else null end,
    claim_token = null,
    claimed_at = null,
    lease_expires_at = null
  where n.id = v_notification.id;

  update private.notification_attempts a set
    finished_at = v_now,
    outcome = v_state::text,
    error_category = case when v_state = 'provider_accepted' then null
      else left(regexp_replace(coalesce(p_error_category, 'unknown'), '[\r\n\t]+', ' ', 'g'), 100) end,
    provider_message_id = case when v_state = 'provider_accepted'
      then left(btrim(p_provider_message_id), 500) else null end
  where a.notification_id = v_notification.id and a.claim_token = p_claim_token;

  return true;
end;
$$;

create or replace function public.scheduler_heartbeat(
  p_job_run_id uuid,
  p_counts jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_counts is null or jsonb_typeof(p_counts) <> 'object' then
    raise exception 'counts must be a JSON object' using errcode = '22023';
  end if;
  update private.job_runs j set
    heartbeat_at = statement_timestamp(),
    counts = j.counts || p_counts
  where j.id = p_job_run_id and j.status = 'running';
  return found;
end;
$$;

create or replace function public.scheduler_finish_run(
  p_job_run_id uuid,
  p_status text,
  p_counts jsonb default '{}'::jsonb,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('succeeded', 'partial_failure', 'failed') then
    raise exception 'unsupported final run status' using errcode = '22023';
  end if;
  if p_counts is null or jsonb_typeof(p_counts) <> 'object' then
    raise exception 'counts must be a JSON object' using errcode = '22023';
  end if;
  update private.job_runs j set
    heartbeat_at = statement_timestamp(),
    finished_at = statement_timestamp(),
    counts = j.counts || p_counts,
    status = p_status::private.job_run_status,
    sanitized_error = case when p_error is null then null
      else left(regexp_replace(p_error, '[\r\n\t]+', ' ', 'g'), 2000) end
  where j.id = p_job_run_id and j.status = 'running';
  return found;
end;
$$;

create or replace function public.scheduler_health()
returns table (
  last_success_at timestamptz,
  last_status text,
  next_expected_at timestamptz,
  failed_count bigint,
  requires_review_count bigint,
  is_stale boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_authenticated_user();
begin
  return query
  with run_state as (
    select
      max(j.finished_at) filter (where j.status = 'succeeded') as success_at,
      (array_agg(j.status::text order by j.started_at desc))[1] as latest_status,
      max(j.heartbeat_at) as latest_heartbeat
    from private.job_runs j
  ), notification_state as (
    select
      count(*) filter (where n.state in ('definitive_failed', 'retryable_failed', 'ambiguous')) as failures,
      count(*) filter (where n.state = 'requires_review') as reviews
    from public.notifications n where n.user_id = v_user_id
  )
  select r.success_at,
    r.latest_status,
    r.latest_heartbeat + interval '15 minutes',
    n.failures,
    n.reviews,
    r.latest_heartbeat is null or r.latest_heartbeat < statement_timestamp() - interval '36 hours'
  from run_state r cross join notification_state n;
end;
$$;

create or replace function public.scheduler_system_health()
returns table (
  database_ready boolean,
  cron_registered boolean,
  scheduler_secret_configured boolean,
  function_url_configured boolean,
  last_success_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select
    true,
    exists (select 1 from cron.job j where j.jobname = 'benefit-notification-processor'),
    exists (select 1 from vault.decrypted_secrets s where s.name = 'scheduler_secret' and length(s.decrypted_secret) >= 32),
    exists (select 1 from vault.decrypted_secrets s where s.name = 'process_notifications_url' and s.decrypted_secret like 'https://%'),
    (select max(j.finished_at) from private.job_runs j where j.status = 'succeeded');
end;
$$;
