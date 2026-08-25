-- Authenticated transactional lifecycle and redemption API.

create or replace function private.require_authenticated_user()
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  return v_user_id;
end;
$$;

create or replace function private.local_today(p_user_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (statement_timestamp() at time zone p.timezone)::date
  from public.profiles p
  where p.user_id = p_user_id;
$$;

create or replace function private.anchor_add_months(p_anchor date, p_offset integer)
returns date
language sql
immutable
security invoker
set search_path = ''
as $$
  with month_bounds as (
    select
      date_trunc('month', p_anchor)::date as source_month_start,
      (date_trunc('month', p_anchor)::date + make_interval(months => p_offset))::date as target_month_start
  ), resolved as (
    select
      source_month_start,
      target_month_start,
      (source_month_start + interval '1 month - 1 day')::date as source_month_end,
      (target_month_start + interval '1 month - 1 day')::date as target_month_end
    from month_bounds
  )
  select case
    when p_anchor = source_month_end then target_month_end
    else target_month_start
      + least(
          extract(day from p_anchor)::integer,
          extract(day from target_month_end)::integer
        ) - 1
  end
  from resolved;
$$;

create or replace function private.calendar_bucket_start(
  p_recurrence_type public.benefit_recurrence_type,
  p_date date
)
returns date
language sql
immutable
security invoker
set search_path = ''
as $$
  select case p_recurrence_type
    when 'monthly' then date_trunc('month', p_date)::date
    when 'quarterly' then date_trunc('quarter', p_date)::date
    when 'semiannual' then make_date(
      extract(year from p_date)::integer,
      case when extract(month from p_date) <= 6 then 1 else 7 end,
      1
    )
    when 'annual' then make_date(extract(year from p_date)::integer, 1, 1)
    else null
  end;
$$;

create or replace function private.assert_benefit_payload(p_payload jsonb)
returns void
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_unknown text;
  v_key text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'benefit payload must be a JSON object' using errcode = '22023';
  end if;

  select key into v_unknown
  from jsonb_object_keys(p_payload) as keys(key)
  where key <> all (array[
    'account_id','name','category','description','notes','active','recurrence_enabled',
    'value_kind','benefit_amount','currency','unit_label','minimum_spend',
    'cashback_percentage','cashback_cap','merchant','merchant_category','website','tags',
    'eligibility_notes','enrollment_required','enrollment_deadline','enrolled_at',
    'effective_date','end_date','recurrence_type','recurrence_basis','anchor_date',
    'interval_months','display_reset_date','expiration_reminder_enabled',
    'reactivation_reminder_enabled'
  ])
  limit 1;

  if v_unknown is not null then
    raise exception 'unsupported benefit field: %', v_unknown using errcode = '22023';
  end if;

  if p_payload ? 'tags'
     and p_payload->'tags' <> 'null'::jsonb
     and jsonb_typeof(p_payload->'tags') <> 'array' then
    raise exception 'tags must be an array of strings' using errcode = '22023';
  end if;

  foreach v_key in array array['benefit_amount','minimum_spend','cashback_cap'] loop
    if p_payload ? v_key and p_payload->v_key <> 'null'::jsonb
       and scale((p_payload->>v_key)::numeric) > 2 then
      raise exception '% accepts at most two fractional digits', v_key using errcode = '22023';
    end if;
  end loop;
  if p_payload ? 'cashback_percentage'
     and p_payload->'cashback_percentage' <> 'null'::jsonb
     and scale((p_payload->>'cashback_percentage')::numeric) > 4 then
    raise exception 'cashback_percentage accepts at most four fractional digits' using errcode = '22023';
  end if;
end;
$$;

create or replace function private.materialize_definition(
  p_definition_id uuid,
  p_from_date date,
  p_through_date date,
  p_source public.instance_source,
  p_allow_reactivation boolean default true,
  p_require_nominal_start boolean default false
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_definition public.benefit_definitions%rowtype;
  v_revision public.benefit_definition_revisions%rowtype;
  v_local_today date;
  v_base date;
  v_nominal_start date;
  v_nominal_end date;
  v_period_start date;
  v_period_end date;
  v_occurrence_key text;
  v_max_sequence integer;
  v_inserted integer := 0;
  v_rows integer;
  v_available numeric(14,2);
  v_unit text;
  v_reactivation boolean;
  v_previous_instance uuid;
  v_instance_version integer;
begin
  if p_from_date is null or p_through_date is null or p_through_date < p_from_date then
    raise exception 'invalid materialization range' using errcode = '22023';
  end if;

  select * into v_definition
  from public.benefit_definitions d
  where d.id = p_definition_id
  for update;

  if not found then
    return 0;
  end if;

  select * into v_revision
  from public.benefit_definition_revisions r
  where r.definition_id = v_definition.id
    and r.revision_no = v_definition.current_revision_no;

  if not found then
    raise exception 'definition has no current revision' using errcode = '23514';
  end if;

  v_local_today := private.local_today(v_definition.user_id);
  v_available := case
    when v_revision.value_kind = 'percentage_cashback' then v_revision.cashback_cap
    else v_revision.benefit_amount
  end;
  v_unit := case
    when v_revision.value_kind in ('money', 'percentage_cashback') then v_revision.currency
    else v_revision.unit_label
  end;

  if v_revision.recurrence_type = 'one_time' then
    v_nominal_start := v_revision.effective_date;
    v_nominal_end := v_revision.end_date;
    v_period_start := v_nominal_start;
    v_period_end := v_nominal_end;
    v_occurrence_key := 'once:' || to_char(v_nominal_start, 'YYYYMMDD');

    select i.id, i.instance_version + 1
      into v_previous_instance, v_instance_version
    from public.benefit_instances i
    where i.definition_id = v_definition.id and i.occurrence_key = v_occurrence_key
    order by i.instance_version desc limit 1;
    v_instance_version := coalesce(v_instance_version, 1);

    insert into public.benefit_instances (
      definition_id, revision_id, user_id, occurrence_key, instance_version,
      supersedes_instance_id, recurrence_sequence,
      nominal_start, nominal_end, period_start, period_end, value_kind,
      available_quantity, is_uncapped, currency, unit_label, period_label,
      generated_source, reactivation_eligible
    ) values (
      v_definition.id, v_revision.id, v_definition.user_id, v_occurrence_key,
      v_instance_version, v_previous_instance, 0,
      v_nominal_start, v_nominal_end, v_period_start, v_period_end, v_revision.value_kind,
      v_available, v_revision.value_kind = 'percentage_cashback' and v_available is null,
      v_revision.currency, v_unit,
      to_char(v_period_start, 'Mon DD, YYYY') || ' – ' || to_char(v_period_end, 'Mon DD, YYYY'),
      p_source, false
    ) on conflict (definition_id, occurrence_key)
      where voided_at is null
      do nothing;
    get diagnostics v_rows = row_count;
    return v_rows;
  end if;

  if not v_definition.recurrence_enabled then
    return 0;
  end if;

  v_base := case
    when v_revision.recurrence_basis = 'calendar'
      then private.calendar_bucket_start(v_revision.recurrence_type, v_revision.effective_date)
    else v_revision.anchor_date
  end;

  v_max_sequence := greatest(0,
    (
      (extract(year from p_through_date)::integer * 12 + extract(month from p_through_date)::integer)
      - (extract(year from v_base)::integer * 12 + extract(month from v_base)::integer)
    ) / v_revision.interval_months + 2
  );

  if v_max_sequence > 2400 then
    raise exception 'recurrence range exceeds safety bound' using errcode = '54000';
  end if;

  for v_sequence in 0..v_max_sequence loop
    if v_revision.recurrence_basis = 'calendar' then
      v_nominal_start := (v_base + make_interval(months => v_sequence * v_revision.interval_months))::date;
      v_nominal_end := (v_nominal_start + make_interval(months => v_revision.interval_months) - interval '1 day')::date;
      v_occurrence_key := 'cal:' || v_revision.recurrence_type::text || ':' || to_char(v_nominal_start, 'YYYYMMDD');
    else
      v_nominal_start := private.anchor_add_months(v_revision.anchor_date, v_sequence * v_revision.interval_months);
      v_nominal_end := private.anchor_add_months(v_revision.anchor_date, (v_sequence + 1) * v_revision.interval_months) - 1;
      v_occurrence_key := 'ann:' || to_char(v_revision.anchor_date, 'YYYYMMDD') || ':'
        || v_revision.interval_months::text || ':' || v_sequence::text;
    end if;

    continue when v_nominal_end < p_from_date;
    continue when v_nominal_start > p_through_date;
    continue when p_require_nominal_start and v_nominal_start < p_from_date;

    v_period_start := greatest(v_nominal_start, v_revision.effective_date, v_revision.valid_from);
    v_period_end := least(v_nominal_end, coalesce(v_revision.end_date, v_nominal_end));
    continue when v_period_end < v_period_start;

    v_reactivation := p_allow_reactivation
      and p_source not in ('backfill', 'import', 're_enable')
      and v_nominal_start > v_local_today;

    v_previous_instance := null;
    v_instance_version := 1;
    select i.id, i.instance_version + 1
      into v_previous_instance, v_instance_version
    from public.benefit_instances i
    where i.definition_id = v_definition.id and i.occurrence_key = v_occurrence_key
    order by i.instance_version desc limit 1;
    v_instance_version := coalesce(v_instance_version, 1);

    insert into public.benefit_instances (
      definition_id, revision_id, user_id, occurrence_key, instance_version,
      supersedes_instance_id, recurrence_sequence,
      nominal_start, nominal_end, period_start, period_end, value_kind,
      available_quantity, is_uncapped, currency, unit_label, period_label,
      generated_source, reactivation_eligible
    ) values (
      v_definition.id, v_revision.id, v_definition.user_id, v_occurrence_key,
      v_instance_version, v_previous_instance, v_sequence,
      v_nominal_start, v_nominal_end, v_period_start, v_period_end, v_revision.value_kind,
      v_available, v_revision.value_kind = 'percentage_cashback' and v_available is null,
      v_revision.currency, v_unit,
      to_char(v_period_start, 'Mon DD, YYYY') || ' – ' || to_char(v_period_end, 'Mon DD, YYYY'),
      p_source, v_reactivation
    ) on conflict (definition_id, occurrence_key)
      where voided_at is null
      do nothing;
    get diagnostics v_rows = row_count;
    v_inserted := v_inserted + v_rows;
  end loop;

  return v_inserted;
end;
$$;

revoke all on function private.require_authenticated_user() from public, anon, authenticated;
revoke all on function private.local_today(uuid) from public, anon, authenticated;
revoke all on function private.anchor_add_months(date, integer) from public, anon, authenticated;
revoke all on function private.calendar_bucket_start(public.benefit_recurrence_type, date) from public, anon, authenticated;
revoke all on function private.assert_benefit_payload(jsonb) from public, anon, authenticated;
revoke all on function private.materialize_definition(uuid, date, date, public.instance_source, boolean, boolean)
  from public, anon, authenticated;

create or replace function public.update_profile_settings(p_settings jsonb)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_authenticated_user();
  v_timezone text;
  v_notification_email text;
  v_confirmed_email text;
  v_result public.profiles%rowtype;
begin
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'settings must be a JSON object' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_settings) as keys(k)
    where k <> all (array['notification_email','timezone','expiration_reminders_enabled',
      'reactivation_reminders_enabled','recent_reset_days'])
  ) then
    raise exception 'settings contain unsupported fields' using errcode = '22023';
  end if;

  v_timezone := case when p_settings ? 'timezone'
    then p_settings->>'timezone'
    else (select p.timezone from public.profiles p where p.user_id = v_user_id)
  end;

  if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_timezone) then
    raise exception 'unknown IANA timezone' using errcode = '22023';
  end if;

  if p_settings ? 'notification_email' then
    v_notification_email := nullif(lower(btrim(p_settings->>'notification_email')), '');
    if v_notification_email is not null
       and v_notification_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'notification email syntax is invalid' using errcode = '22023';
    end if;
    if v_notification_email is not null then
      select lower(u.email) into v_confirmed_email
      from auth.users u
      where u.id = v_user_id and u.email_confirmed_at is not null;
      if v_confirmed_email is null or v_notification_email <> v_confirmed_email then
        raise exception 'notification email must match the confirmed authentication email in v1'
          using errcode = '22023';
      end if;
    end if;
  end if;

  update public.profiles p set
    notification_email = case when p_settings ? 'notification_email'
      then v_notification_email else p.notification_email end,
    timezone = v_timezone,
    expiration_reminders_enabled = case when p_settings ? 'expiration_reminders_enabled'
      then (p_settings->>'expiration_reminders_enabled')::boolean else p.expiration_reminders_enabled end,
    reactivation_reminders_enabled = case when p_settings ? 'reactivation_reminders_enabled'
      then (p_settings->>'reactivation_reminders_enabled')::boolean else p.reactivation_reminders_enabled end,
    recent_reset_days = case when p_settings ? 'recent_reset_days'
      then (p_settings->>'recent_reset_days')::smallint else p.recent_reset_days end,
    updated_at = statement_timestamp()
  where p.user_id = v_user_id
  returning p.* into v_result;

  return v_result;
end;
$$;

create or replace function public.create_benefit(
  p_benefit jsonb,
  p_backfill_months integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_authenticated_user();
  v_definition public.benefit_definitions%rowtype;
  v_revision_id uuid;
  v_today date := private.local_today(v_user_id);
  v_interval integer;
  v_from date;
  v_through date;
  v_current_instance uuid;
  v_generated integer;
begin
  perform private.assert_benefit_payload(p_benefit);
  if p_backfill_months < 0 or p_backfill_months > 24 then
    raise exception 'backfill_months must be between 0 and 24' using errcode = '22023';
  end if;

  if p_benefit ? 'account_id' and p_benefit->>'account_id' is not null
     and not exists (
       select 1 from public.accounts a
       where a.id = (p_benefit->>'account_id')::uuid and a.user_id = v_user_id
     ) then
    raise exception 'account not found' using errcode = '23503';
  end if;

  v_interval := case coalesce(p_benefit->>'recurrence_type', 'one_time')
    when 'monthly' then 1
    when 'quarterly' then 3
    when 'semiannual' then 6
    when 'annual' then 12
    when 'custom' then (p_benefit->>'interval_months')::integer
    else null
  end;

  insert into public.benefit_definitions (
    user_id, account_id, name, category, description, notes, active,
    recurrence_enabled, value_kind, benefit_amount, currency, unit_label,
    minimum_spend, cashback_percentage, cashback_cap, merchant, merchant_category,
    website, tags, eligibility_notes, enrollment_required, enrollment_deadline,
    enrolled_at, effective_date, end_date, recurrence_type, recurrence_basis,
    anchor_date, interval_months, display_reset_date, expiration_reminder_enabled,
    reactivation_reminder_enabled
  ) values (
    v_user_id,
    nullif(p_benefit->>'account_id', '')::uuid,
    btrim(p_benefit->>'name'),
    btrim(p_benefit->>'category'),
    nullif(btrim(p_benefit->>'description'), ''),
    nullif(btrim(p_benefit->>'notes'), ''),
    coalesce((p_benefit->>'active')::boolean, true),
    case when coalesce(p_benefit->>'recurrence_type', 'one_time') = 'one_time'
      then false else coalesce((p_benefit->>'recurrence_enabled')::boolean, true) end,
    (p_benefit->>'value_kind')::public.benefit_value_kind,
    nullif(p_benefit->>'benefit_amount', '')::numeric,
    nullif(upper(p_benefit->>'currency'), ''),
    nullif(btrim(p_benefit->>'unit_label'), ''),
    nullif(p_benefit->>'minimum_spend', '')::numeric,
    nullif(p_benefit->>'cashback_percentage', '')::numeric,
    nullif(p_benefit->>'cashback_cap', '')::numeric,
    nullif(btrim(p_benefit->>'merchant'), ''),
    nullif(btrim(p_benefit->>'merchant_category'), ''),
    nullif(btrim(p_benefit->>'website'), ''),
    case when jsonb_typeof(p_benefit->'tags') = 'array'
      then array(select jsonb_array_elements_text(p_benefit->'tags')) else '{}'::text[] end,
    nullif(btrim(p_benefit->>'eligibility_notes'), ''),
    coalesce((p_benefit->>'enrollment_required')::boolean, false),
    nullif(p_benefit->>'enrollment_deadline', '')::date,
    nullif(p_benefit->>'enrolled_at', '')::date,
    (p_benefit->>'effective_date')::date,
    nullif(p_benefit->>'end_date', '')::date,
    coalesce(p_benefit->>'recurrence_type', 'one_time')::public.benefit_recurrence_type,
    coalesce(p_benefit->>'recurrence_basis',
      case when coalesce(p_benefit->>'recurrence_type', 'one_time') = 'one_time'
        then 'none' else 'calendar' end)::public.benefit_recurrence_basis,
    nullif(p_benefit->>'anchor_date', '')::date,
    v_interval,
    nullif(p_benefit->>'display_reset_date', '')::date,
    coalesce((p_benefit->>'expiration_reminder_enabled')::boolean, true),
    coalesce((p_benefit->>'reactivation_reminder_enabled')::boolean, true)
  ) returning * into v_definition;

  perform set_config('app.lifecycle_write', 'on', true);
  insert into public.benefit_definition_revisions (
    definition_id, user_id, revision_no, valid_from, account_id, name, category,
    description, notes, value_kind, benefit_amount, currency, unit_label,
    minimum_spend, cashback_percentage, cashback_cap, merchant, merchant_category,
    website, tags, eligibility_notes, enrollment_required, enrollment_deadline,
    effective_date, end_date, recurrence_type, recurrence_basis, anchor_date,
    interval_months, display_reset_date, expiration_reminder_enabled,
    reactivation_reminder_enabled
  ) values (
    v_definition.id, v_user_id, 1, v_definition.effective_date - 1, v_definition.account_id,
    v_definition.name, v_definition.category, v_definition.description, v_definition.notes,
    v_definition.value_kind, v_definition.benefit_amount, v_definition.currency,
    v_definition.unit_label, v_definition.minimum_spend, v_definition.cashback_percentage,
    v_definition.cashback_cap, v_definition.merchant, v_definition.merchant_category,
    v_definition.website, v_definition.tags, v_definition.eligibility_notes,
    v_definition.enrollment_required, v_definition.enrollment_deadline,
    v_definition.effective_date, v_definition.end_date, v_definition.recurrence_type,
    v_definition.recurrence_basis, v_definition.anchor_date, v_definition.interval_months,
    v_definition.display_reset_date,
    v_definition.expiration_reminder_enabled, v_definition.reactivation_reminder_enabled
  ) returning id into v_revision_id;

  v_from := case when p_backfill_months = 0 then v_today
    else (v_today - make_interval(months => p_backfill_months))::date end;
  v_through := greatest(
    v_today + 31,
    (v_today + make_interval(months => coalesce(v_interval, 0)))::date,
    v_definition.effective_date
  );
  v_generated := private.materialize_definition(
    v_definition.id, v_from, v_through,
    case when p_backfill_months > 0 then 'backfill'::public.instance_source
      else 'creation'::public.instance_source end,
    p_backfill_months = 0,
    false
  );

  select i.id into v_current_instance
  from public.benefit_instances i
  where i.definition_id = v_definition.id
    and i.voided_at is null
    and v_today between i.period_start and i.period_end
  order by i.period_start
  limit 1;

  return jsonb_build_object(
    'definition_id', v_definition.id,
    'current_instance_id', v_current_instance,
    'revision_id', v_revision_id,
    'generated_instances', v_generated
  );
end;
$$;

create or replace function private.insert_revision_from_definition(
  p_definition_id uuid,
  p_valid_from date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform set_config('app.lifecycle_write', 'on', true);
  insert into public.benefit_definition_revisions (
    definition_id, user_id, revision_no, valid_from, account_id, name, category,
    description, notes, value_kind, benefit_amount, currency, unit_label,
    minimum_spend, cashback_percentage, cashback_cap, merchant, merchant_category,
    website, tags, eligibility_notes, enrollment_required, enrollment_deadline,
    effective_date, end_date, recurrence_type, recurrence_basis, anchor_date,
    interval_months, display_reset_date, expiration_reminder_enabled,
    reactivation_reminder_enabled
  )
  select d.id, d.user_id, d.current_revision_no, p_valid_from, d.account_id,
    d.name, d.category, d.description, d.notes, d.value_kind, d.benefit_amount,
    d.currency, d.unit_label, d.minimum_spend, d.cashback_percentage, d.cashback_cap,
    d.merchant, d.merchant_category, d.website, d.tags, d.eligibility_notes,
    d.enrollment_required, d.enrollment_deadline, d.effective_date, d.end_date,
    d.recurrence_type, d.recurrence_basis, d.anchor_date, d.interval_months,
    d.display_reset_date,
    d.expiration_reminder_enabled, d.reactivation_reminder_enabled
  from public.benefit_definitions d
  where d.id = p_definition_id
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function private.insert_revision_from_definition(uuid, date)
  from public, anon, authenticated;

create or replace function public.edit_benefit(
  p_definition_id uuid,
  p_changes jsonb,
  p_scope text default 'future_periods',
  p_effective_from date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_authenticated_user();
  v_definition public.benefit_definitions%rowtype;
  v_open_revision public.benefit_definition_revisions%rowtype;
  v_today date := private.local_today(v_user_id);
  v_boundary date;
  v_new_revision uuid;
  v_generated integer := 0;
  v_through date;
  v_protected_change boolean;
  v_interval integer;
  v_old_instance record;
  v_replacement uuid;
begin
  perform private.assert_benefit_payload(p_changes);
  if p_scope not in ('future_periods', 'current_and_future') then
    raise exception 'scope must be future_periods or current_and_future; use override_instance for one period'
      using errcode = '22023';
  end if;
  select * into v_definition
  from public.benefit_definitions d
  where d.id = p_definition_id and d.user_id = v_user_id
  for update;
  if not found then
    raise exception 'benefit not found' using errcode = 'P0002';
  end if;
  if (p_changes ? 'active' and (p_changes->>'active')::boolean is distinct from v_definition.active)
     or (p_changes ? 'recurrence_enabled'
       and (p_changes->>'recurrence_enabled')::boolean is distinct from v_definition.recurrence_enabled) then
    raise exception 'use the dedicated active/recurrence lifecycle RPC' using errcode = '22023';
  end if;

  select * into v_open_revision
  from public.benefit_definition_revisions r
  where r.definition_id = v_definition.id and r.valid_to is null
  for update;

  -- Enrollment is mutable fulfillment state, not revisioned business configuration.
  if p_changes ? 'enrolled_at'
     and (select count(*) from jsonb_object_keys(p_changes)) = 1 then
    update public.benefit_definitions d
      set enrolled_at = nullif(p_changes->>'enrolled_at', '')::date
    where d.id = v_definition.id
    returning * into v_definition;
    return jsonb_build_object(
      'definition_id', v_definition.id,
      'enrolled_at', v_definition.enrolled_at,
      'state_only', true
    );
  end if;

  if p_scope = 'future_periods' then
    select coalesce(p_effective_from, min(i.period_start)) into v_boundary
    from public.benefit_instances i
    where i.definition_id = v_definition.id
      and i.voided_at is null
      and i.period_start > v_today;
  else
    select coalesce(p_effective_from, i.period_start) into v_boundary
    from public.benefit_instances i
    where i.definition_id = v_definition.id
      and i.voided_at is null
      and v_today between i.period_start and i.period_end
    order by i.period_start limit 1;
  end if;

  if v_boundary is null or v_boundary < v_open_revision.valid_from then
    raise exception 'edit boundary must be an occurrence boundary after the open revision start'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.benefit_instances i
    where i.definition_id = v_definition.id and i.voided_at is null
      and i.period_start = v_boundary
  ) then
    raise exception 'edit boundary must match an existing occurrence boundary' using errcode = '22023';
  end if;

  v_protected_change :=
    (p_changes ? 'value_kind' and (p_changes->>'value_kind')::public.benefit_value_kind is distinct from v_definition.value_kind)
    or (p_changes ? 'benefit_amount' and nullif(p_changes->>'benefit_amount', '')::numeric is distinct from v_definition.benefit_amount)
    or (p_changes ? 'currency' and nullif(upper(p_changes->>'currency'), '') is distinct from v_definition.currency)
    or (p_changes ? 'unit_label' and nullif(btrim(p_changes->>'unit_label'), '') is distinct from v_definition.unit_label)
    or (p_changes ? 'minimum_spend' and nullif(p_changes->>'minimum_spend', '')::numeric is distinct from v_definition.minimum_spend)
    or (p_changes ? 'cashback_percentage' and nullif(p_changes->>'cashback_percentage', '')::numeric is distinct from v_definition.cashback_percentage)
    or (p_changes ? 'cashback_cap' and nullif(p_changes->>'cashback_cap', '')::numeric is distinct from v_definition.cashback_cap)
    or (p_changes ? 'effective_date' and (p_changes->>'effective_date')::date is distinct from v_definition.effective_date)
    or (p_changes ? 'end_date' and nullif(p_changes->>'end_date', '')::date is distinct from v_definition.end_date)
    or (p_changes ? 'recurrence_type' and (p_changes->>'recurrence_type')::public.benefit_recurrence_type is distinct from v_definition.recurrence_type)
    or (p_changes ? 'recurrence_basis' and (p_changes->>'recurrence_basis')::public.benefit_recurrence_basis is distinct from v_definition.recurrence_basis)
    or (p_changes ? 'anchor_date' and nullif(p_changes->>'anchor_date', '')::date is distinct from v_definition.anchor_date)
    or (p_changes ? 'interval_months' and nullif(p_changes->>'interval_months', '')::integer is distinct from v_definition.interval_months);

  if p_scope = 'current_and_future' and v_protected_change and exists (
    select 1
    from public.benefit_instances i
    where i.definition_id = v_definition.id and i.voided_at is null
      and i.period_start = v_boundary
      and (
        exists (select 1 from public.redemptions r where r.benefit_instance_id = i.id)
        or exists (select 1 from public.notifications n where n.benefit_instance_id = i.id and n.first_attempt_at is not null)
      )
  ) then
    raise exception 'current period has usage or a notification attempt; use future-only plus explicit override'
      using errcode = '55000';
  end if;

  if p_changes ? 'account_id' and p_changes->>'account_id' is not null
     and not exists (
       select 1 from public.accounts a
       where a.id = (p_changes->>'account_id')::uuid and a.user_id = v_user_id
     ) then
    raise exception 'account not found' using errcode = '23503';
  end if;

  v_interval := case coalesce(p_changes->>'recurrence_type', v_definition.recurrence_type::text)
    when 'monthly' then 1
    when 'quarterly' then 3
    when 'semiannual' then 6
    when 'annual' then 12
    when 'custom' then coalesce(nullif(p_changes->>'interval_months', '')::integer, v_definition.interval_months)
    else null
  end;

  perform set_config('app.lifecycle_write', 'on', true);
  update public.benefit_definition_revisions r
  set valid_to = v_boundary - 1, closed_at = statement_timestamp()
  where r.id = v_open_revision.id;

  update public.benefit_definitions d set
    account_id = case when p_changes ? 'account_id' then nullif(p_changes->>'account_id', '')::uuid else d.account_id end,
    name = case when p_changes ? 'name' then btrim(p_changes->>'name') else d.name end,
    category = case when p_changes ? 'category' then btrim(p_changes->>'category') else d.category end,
    description = case when p_changes ? 'description' then nullif(btrim(p_changes->>'description'), '') else d.description end,
    notes = case when p_changes ? 'notes' then nullif(btrim(p_changes->>'notes'), '') else d.notes end,
    recurrence_enabled = case
      when coalesce(p_changes->>'recurrence_type', d.recurrence_type::text) = 'one_time' then false
      when p_changes ? 'recurrence_type' and d.recurrence_type = 'one_time' then true
      else d.recurrence_enabled
    end,
    value_kind = case when p_changes ? 'value_kind' then (p_changes->>'value_kind')::public.benefit_value_kind else d.value_kind end,
    benefit_amount = case when p_changes ? 'benefit_amount' then nullif(p_changes->>'benefit_amount', '')::numeric else d.benefit_amount end,
    currency = case when p_changes ? 'currency' then nullif(upper(p_changes->>'currency'), '') else d.currency end,
    unit_label = case when p_changes ? 'unit_label' then nullif(btrim(p_changes->>'unit_label'), '') else d.unit_label end,
    minimum_spend = case when p_changes ? 'minimum_spend' then nullif(p_changes->>'minimum_spend', '')::numeric else d.minimum_spend end,
    cashback_percentage = case when p_changes ? 'cashback_percentage' then nullif(p_changes->>'cashback_percentage', '')::numeric else d.cashback_percentage end,
    cashback_cap = case when p_changes ? 'cashback_cap' then nullif(p_changes->>'cashback_cap', '')::numeric else d.cashback_cap end,
    merchant = case when p_changes ? 'merchant' then nullif(btrim(p_changes->>'merchant'), '') else d.merchant end,
    merchant_category = case when p_changes ? 'merchant_category' then nullif(btrim(p_changes->>'merchant_category'), '') else d.merchant_category end,
    website = case when p_changes ? 'website' then nullif(btrim(p_changes->>'website'), '') else d.website end,
    tags = case when p_changes ? 'tags' and jsonb_typeof(p_changes->'tags') = 'array'
      then array(select jsonb_array_elements_text(p_changes->'tags'))
      when p_changes ? 'tags' then '{}'::text[] else d.tags end,
    eligibility_notes = case when p_changes ? 'eligibility_notes' then nullif(btrim(p_changes->>'eligibility_notes'), '') else d.eligibility_notes end,
    enrollment_required = case when p_changes ? 'enrollment_required' then (p_changes->>'enrollment_required')::boolean else d.enrollment_required end,
    enrollment_deadline = case when p_changes ? 'enrollment_deadline' then nullif(p_changes->>'enrollment_deadline', '')::date else d.enrollment_deadline end,
    enrolled_at = case when p_changes ? 'enrolled_at' then nullif(p_changes->>'enrolled_at', '')::date else d.enrolled_at end,
    effective_date = case when p_changes ? 'effective_date' then (p_changes->>'effective_date')::date else d.effective_date end,
    end_date = case when p_changes ? 'end_date' then nullif(p_changes->>'end_date', '')::date else d.end_date end,
    recurrence_type = case when p_changes ? 'recurrence_type' then (p_changes->>'recurrence_type')::public.benefit_recurrence_type else d.recurrence_type end,
    recurrence_basis = case when p_changes ? 'recurrence_basis' then (p_changes->>'recurrence_basis')::public.benefit_recurrence_basis else d.recurrence_basis end,
    anchor_date = case when p_changes ? 'anchor_date' then nullif(p_changes->>'anchor_date', '')::date else d.anchor_date end,
    interval_months = v_interval,
    display_reset_date = case when p_changes ? 'display_reset_date' then nullif(p_changes->>'display_reset_date', '')::date else d.display_reset_date end,
    expiration_reminder_enabled = case when p_changes ? 'expiration_reminder_enabled' then (p_changes->>'expiration_reminder_enabled')::boolean else d.expiration_reminder_enabled end,
    reactivation_reminder_enabled = case when p_changes ? 'reactivation_reminder_enabled' then (p_changes->>'reactivation_reminder_enabled')::boolean else d.reactivation_reminder_enabled end,
    current_revision_no = d.current_revision_no + 1
  where d.id = v_definition.id
  returning * into v_definition;

  v_new_revision := private.insert_revision_from_definition(v_definition.id, v_boundary);

  -- plpgsql_check cannot infer temp-table shapes created inside a function.
  -- This string expression is a checker pragma and a harmless no-op at runtime.
  perform 'PRAGMA:TABLE: pg_temp.replaced_benefit_instances(old_instance_id uuid, occurrence_key text, period_start date, period_end date)';
  drop table if exists pg_temp.replaced_benefit_instances;
  create temporary table pg_temp.replaced_benefit_instances (
    old_instance_id uuid primary key,
    occurrence_key text not null,
    period_start date not null,
    period_end date not null
  ) on commit drop;

  for v_old_instance in
    select i.* from public.benefit_instances i
    where i.definition_id = v_definition.id and i.voided_at is null
      and i.period_start >= v_boundary
    order by i.period_start
    for update
  loop
    if exists (
      select 1 from public.notifications n
      where n.benefit_instance_id = v_old_instance.id and n.first_attempt_at is not null
    ) then
      continue;
    end if;
    if v_protected_change and exists (
      select 1 from public.redemptions r where r.benefit_instance_id = v_old_instance.id
    ) then
      raise exception 'a period selected for protected reconciliation already has usage'
        using errcode = '55000';
    end if;
    insert into pg_temp.replaced_benefit_instances values (
      v_old_instance.id, v_old_instance.occurrence_key,
      v_old_instance.period_start, v_old_instance.period_end
    );
    update public.benefit_instances
      set voided_at = statement_timestamp(), void_reason = 'Replaced by definition revision ' || v_definition.current_revision_no
      where id = v_old_instance.id;
  end loop;

  select greatest(
    coalesce(max(r.period_end), v_boundary),
    v_today + 31,
    (v_today + make_interval(months => coalesce(v_definition.interval_months, 0)))::date
  ) into v_through
  from pg_temp.replaced_benefit_instances r;

  -- An edit boundary can be a period_start clipped by effective/revision validity,
  -- so reconciliation must include the nominal occurrence overlapping that boundary.
  -- Recurrence re-enable separately requires a genuinely future nominal start.
  v_generated := private.materialize_definition(
    v_definition.id, v_boundary, v_through, 'regeneration', true, false
  );

  for v_old_instance in select * from pg_temp.replaced_benefit_instances loop
    select i.id into v_replacement
    from public.benefit_instances i
    where i.definition_id = v_definition.id and i.voided_at is null
      and (i.occurrence_key = v_old_instance.occurrence_key
        or i.period_start between v_old_instance.period_start and v_old_instance.period_end)
    order by (i.occurrence_key = v_old_instance.occurrence_key) desc, i.instance_version desc
    limit 1;

    if v_replacement is null then
      update public.notifications n
      set state = 'skipped', next_attempt_at = null
      where n.benefit_instance_id = v_old_instance.old_instance_id
        and n.first_attempt_at is null;
    else
      update public.redemptions r set benefit_instance_id = v_replacement
      where r.benefit_instance_id = v_old_instance.old_instance_id;

      update public.notifications n
      set state = 'superseded', superseded_by_instance_id = v_replacement,
          next_attempt_at = null
      where n.benefit_instance_id = v_old_instance.old_instance_id
        and n.first_attempt_at is null;
    end if;
  end loop;

  return jsonb_build_object(
    'definition_id', v_definition.id,
    'revision_id', v_new_revision,
    'revision_no', v_definition.current_revision_no,
    'effective_from', v_boundary,
    'generated_instances', v_generated
  );
end;
$$;

create or replace function public.set_recurrence_enabled(
  p_definition_id uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_authenticated_user();
  v_definition public.benefit_definitions%rowtype;
  v_today date := private.local_today(v_user_id);
  v_voided integer := 0;
  v_generated integer := 0;
begin
  select * into v_definition from public.benefit_definitions d
  where d.id = p_definition_id and d.user_id = v_user_id for update;
  if not found then raise exception 'benefit not found' using errcode = 'P0002'; end if;
  if v_definition.recurrence_type = 'one_time' then
    raise exception 'one-time benefits cannot enable recurrence' using errcode = '22023';
  end if;

  if v_definition.recurrence_enabled = p_enabled then
    return jsonb_build_object('definition_id', v_definition.id, 'recurrence_enabled', p_enabled,
      'voided_instances', 0, 'generated_instances', 0);
  end if;

  update public.benefit_definitions d set recurrence_enabled = p_enabled
  where d.id = v_definition.id;

  if not p_enabled then
    with candidates as (
      select i.id from public.benefit_instances i
      where i.definition_id = v_definition.id and i.voided_at is null
        and i.period_start > v_today
        and not exists (select 1 from public.redemptions r where r.benefit_instance_id = i.id)
        and not exists (select 1 from public.notifications n where n.benefit_instance_id = i.id and n.first_attempt_at is not null)
      for update
    ), voided as (
      update public.benefit_instances i
      set voided_at = statement_timestamp(), void_reason = 'Recurrence disabled'
      from candidates c where i.id = c.id returning i.id
    )
    select count(*) into v_voided from voided;

    update public.notifications n set state = 'skipped', next_attempt_at = null
    where n.first_attempt_at is null and exists (
      select 1 from public.benefit_instances i
      where i.id = n.benefit_instance_id and i.definition_id = v_definition.id and i.voided_at is not null
    );
  else
    v_generated := private.materialize_definition(
      v_definition.id,
      v_today + 1,
      greatest(v_today + 31,
        (v_today + make_interval(months => v_definition.interval_months))::date),
      're_enable', false, true
    );
  end if;

  return jsonb_build_object('definition_id', v_definition.id, 'recurrence_enabled', p_enabled,
    'voided_instances', v_voided, 'generated_instances', v_generated);
end;
$$;

create or replace function public.set_benefit_active(
  p_definition_id uuid,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_authenticated_user();
  v_rows integer;
begin
  update public.benefit_definitions d set active = p_active
  where d.id = p_definition_id and d.user_id = v_user_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'benefit not found' using errcode = 'P0002'; end if;

  if not p_active then
    update public.notifications n set state = 'skipped', next_attempt_at = null
    where n.user_id = v_user_id and n.first_attempt_at is null
      and n.state in ('pending', 'retryable_failed', 'ambiguous', 'skipped')
      and exists (
        select 1 from public.benefit_instances i
        where i.id = n.benefit_instance_id and i.definition_id = p_definition_id
      );
  end if;
  return jsonb_build_object('definition_id', p_definition_id, 'active', p_active);
end;
$$;

create or replace function public.override_instance(
  p_instance_id uuid,
  p_changes jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_authenticated_user();
  v_old public.benefit_instances%rowtype;
  v_new public.benefit_instances%rowtype;
  v_redeemed numeric;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'object'
     or exists (
       select 1 from jsonb_object_keys(p_changes) as keys(key)
       where key <> all (array['available_quantity','period_start','period_end','period_label',
         'expiration_notification_suppressed'])
     ) then
    raise exception 'unsupported instance override fields' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) not between 1 and 1000 then
    raise exception 'override reason is required' using errcode = '22023';
  end if;

  select * into v_old from public.benefit_instances i
  where i.id = p_instance_id and i.user_id = v_user_id and i.voided_at is null
  ;
  if not found then raise exception 'live benefit instance not found' using errcode = 'P0002'; end if;
  perform 1 from public.benefit_definitions d
  where d.id = v_old.definition_id and d.user_id = v_user_id for update;
  select * into v_old from public.benefit_instances i
  where i.id = p_instance_id and i.user_id = v_user_id and i.voided_at is null
  for update;
  if not found then raise exception 'live benefit instance changed concurrently' using errcode = '40001'; end if;
  if exists (select 1 from public.notifications n where n.benefit_instance_id = v_old.id and n.first_attempt_at is not null) then
    raise exception 'attempted notification protects this instance; override is not safe' using errcode = '55000';
  end if;

  select coalesce(sum(r.redeemed_quantity), 0) into v_redeemed
  from public.redemptions r where r.benefit_instance_id = v_old.id;
  if not v_old.is_uncapped
     and coalesce(nullif(p_changes->>'available_quantity', '')::numeric, v_old.available_quantity) < v_redeemed then
    raise exception 'availability cannot be lower than redeemed quantity' using errcode = '23514';
  end if;

  update public.benefit_instances i
    set voided_at = statement_timestamp(), void_reason = btrim(p_reason)
  where i.id = v_old.id;

  insert into public.benefit_instances (
    definition_id, revision_id, user_id, occurrence_key, instance_version,
    supersedes_instance_id, recurrence_sequence, nominal_start, nominal_end,
    period_start, period_end, value_kind, available_quantity, is_uncapped,
    currency, unit_label, period_label, generated_source, generated_at,
    reactivation_eligible, expiration_notification_suppressed,
    manual_completed_at, manual_completion_note
  ) values (
    v_old.definition_id, v_old.revision_id, v_old.user_id, v_old.occurrence_key,
    v_old.instance_version + 1, v_old.id, v_old.recurrence_sequence,
    v_old.nominal_start, v_old.nominal_end,
    case when p_changes ? 'period_start' then (p_changes->>'period_start')::date else v_old.period_start end,
    case when p_changes ? 'period_end' then (p_changes->>'period_end')::date else v_old.period_end end,
    v_old.value_kind,
    case when p_changes ? 'available_quantity' then nullif(p_changes->>'available_quantity', '')::numeric else v_old.available_quantity end,
    v_old.is_uncapped, v_old.currency, v_old.unit_label,
    case when p_changes ? 'period_label' then btrim(p_changes->>'period_label') else v_old.period_label end,
    'regeneration', statement_timestamp(), v_old.reactivation_eligible,
    case when p_changes ? 'expiration_notification_suppressed'
      then (p_changes->>'expiration_notification_suppressed')::boolean
      else v_old.expiration_notification_suppressed end,
    v_old.manual_completed_at, v_old.manual_completion_note
  ) returning * into v_new;

  update public.redemptions r set benefit_instance_id = v_new.id
  where r.benefit_instance_id = v_old.id;

  update public.notifications n
  set state = 'superseded', superseded_by_instance_id = v_new.id, next_attempt_at = null
  where n.benefit_instance_id = v_old.id and n.first_attempt_at is null;

  return jsonb_build_object('old_instance_id', v_old.id, 'instance_id', v_new.id,
    'instance_version', v_new.instance_version);
end;
$$;

create or replace function public.record_redemption(
  p_instance_id uuid,
  p_redeemed_quantity numeric,
  p_used_date date,
  p_merchant text default null,
  p_transaction_description text default null,
  p_notes text default null
)
returns public.redemptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_authenticated_user();
  v_instance public.benefit_instances%rowtype;
  v_existing numeric;
  v_result public.redemptions%rowtype;
begin
  select * into v_instance from public.benefit_instances i
  where i.id = p_instance_id and i.user_id = v_user_id and i.voided_at is null
  for update;
  if not found then raise exception 'live benefit instance not found' using errcode = 'P0002'; end if;
  if p_redeemed_quantity is null or p_redeemed_quantity <= 0
     or p_redeemed_quantity <> round(p_redeemed_quantity, 2) then
    raise exception 'redeemed quantity must be positive with at most two decimals' using errcode = '22023';
  end if;
  if v_instance.value_kind = 'points' and p_redeemed_quantity <> trunc(p_redeemed_quantity) then
    raise exception 'points redemptions must use whole units' using errcode = '22023';
  end if;
  if p_used_date not between v_instance.period_start and v_instance.period_end then
    raise exception 'used date must be within the benefit period' using errcode = '22023';
  end if;
  if v_instance.manual_completed_at is not null then
    raise exception 'completed uncapped benefit cannot receive another redemption' using errcode = '55000';
  end if;

  select coalesce(sum(r.redeemed_quantity), 0) into v_existing
  from public.redemptions r where r.benefit_instance_id = v_instance.id;
  if not v_instance.is_uncapped and v_existing + p_redeemed_quantity > v_instance.available_quantity then
    raise exception 'redemption exceeds remaining quantity' using errcode = '23514';
  end if;

  insert into public.redemptions (
    benefit_instance_id, user_id, redeemed_quantity, used_date,
    merchant, transaction_description, notes
  ) values (
    v_instance.id, v_user_id, p_redeemed_quantity, p_used_date,
    nullif(btrim(p_merchant), ''), nullif(btrim(p_transaction_description), ''),
    nullif(btrim(p_notes), '')
  ) returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.edit_redemption(
  p_redemption_id uuid,
  p_redeemed_quantity numeric,
  p_used_date date,
  p_merchant text default null,
  p_transaction_description text default null,
  p_notes text default null
)
returns public.redemptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_authenticated_user();
  v_redemption public.redemptions%rowtype;
  v_instance public.benefit_instances%rowtype;
  v_other_total numeric;
begin
  select * into v_redemption from public.redemptions r
  where r.id = p_redemption_id and r.user_id = v_user_id;
  if not found then raise exception 'redemption not found' using errcode = 'P0002'; end if;

  select * into v_instance from public.benefit_instances i
  where i.id = v_redemption.benefit_instance_id and i.user_id = v_user_id and i.voided_at is null
  for update;
  if not found then raise exception 'live benefit instance not found' using errcode = 'P0002'; end if;
  if p_redeemed_quantity is null or p_redeemed_quantity <= 0
     or p_redeemed_quantity <> round(p_redeemed_quantity, 2) then
    raise exception 'redeemed quantity must be positive with at most two decimals' using errcode = '22023';
  end if;
  if v_instance.value_kind = 'points' and p_redeemed_quantity <> trunc(p_redeemed_quantity) then
    raise exception 'points redemptions must use whole units' using errcode = '22023';
  end if;
  if p_used_date not between v_instance.period_start and v_instance.period_end then
    raise exception 'used date must be within the benefit period' using errcode = '22023';
  end if;

  select coalesce(sum(r.redeemed_quantity), 0) into v_other_total
  from public.redemptions r
  where r.benefit_instance_id = v_instance.id and r.id <> v_redemption.id;
  if not v_instance.is_uncapped and v_other_total + p_redeemed_quantity > v_instance.available_quantity then
    raise exception 'redemption exceeds remaining quantity' using errcode = '23514';
  end if;

  update public.redemptions r set
    redeemed_quantity = p_redeemed_quantity,
    used_date = p_used_date,
    merchant = nullif(btrim(p_merchant), ''),
    transaction_description = nullif(btrim(p_transaction_description), ''),
    notes = nullif(btrim(p_notes), '')
  where r.id = v_redemption.id
  returning * into v_redemption;
  return v_redemption;
end;
$$;

create or replace function public.delete_redemption(p_redemption_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_authenticated_user();
  v_instance_id uuid;
begin
  select r.benefit_instance_id into v_instance_id
  from public.redemptions r
  where r.id = p_redemption_id and r.user_id = v_user_id;
  if not found then return false; end if;
  perform 1 from public.benefit_instances i where i.id = v_instance_id for update;
  delete from public.redemptions r where r.id = p_redemption_id and r.user_id = v_user_id;
  return found;
end;
$$;

create or replace function public.mark_uncapped_complete(
  p_instance_id uuid,
  p_note text default null
)
returns public.benefit_instances
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_authenticated_user();
  v_result public.benefit_instances%rowtype;
begin
  select * into v_result from public.benefit_instances i
  where i.id = p_instance_id and i.user_id = v_user_id and i.voided_at is null
  for update;
  if not found then raise exception 'live benefit instance not found' using errcode = 'P0002'; end if;
  if not v_result.is_uncapped then
    raise exception 'only uncapped cashback can be explicitly completed' using errcode = '22023';
  end if;
  if v_result.manual_completed_at is null then
    update public.benefit_instances i set
      manual_completed_at = statement_timestamp(),
      manual_completion_note = nullif(btrim(p_note), '')
    where i.id = v_result.id returning * into v_result;
  end if;
  return v_result;
end;
$$;

create or replace function public.mark_finite_used(
  p_instance_id uuid,
  p_used_date date,
  p_merchant text default null,
  p_transaction_description text default null,
  p_notes text default null
)
returns public.redemptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_authenticated_user();
  v_instance public.benefit_instances%rowtype;
  v_remaining numeric;
begin
  select * into v_instance from public.benefit_instances i
  where i.id = p_instance_id and i.user_id = v_user_id and i.voided_at is null
  for update;
  if not found then raise exception 'live benefit instance not found' using errcode = 'P0002'; end if;
  if v_instance.is_uncapped then
    raise exception 'use mark_uncapped_complete for uncapped benefits' using errcode = '22023';
  end if;
  select v_instance.available_quantity - coalesce(sum(r.redeemed_quantity), 0)
    into v_remaining
  from public.redemptions r where r.benefit_instance_id = v_instance.id;
  if v_remaining <= 0 then
    raise exception 'benefit is already fully used' using errcode = '55000';
  end if;
  return public.record_redemption(v_instance.id, v_remaining, p_used_date,
    p_merchant, p_transaction_description, p_notes);
end;
$$;

create or replace function public.delete_benefit_draft(p_definition_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_authenticated_user();
  v_definition public.benefit_definitions%rowtype;
begin
  select * into v_definition from public.benefit_definitions d
  where d.id = p_definition_id and d.user_id = v_user_id for update;
  if not found then return false; end if;
  if exists (
    select 1 from public.benefit_instances i
    where i.definition_id = v_definition.id and (
      exists (select 1 from public.redemptions r where r.benefit_instance_id = i.id)
      or exists (select 1 from public.notifications n where n.benefit_instance_id = i.id)
      or i.period_start <= private.local_today(v_user_id)
    )
  ) then
    raise exception 'only an unreferenced future draft may be hard-deleted; deactivate instead'
      using errcode = '55000';
  end if;
  perform set_config('app.lifecycle_write', 'on', true);
  delete from public.benefit_definitions d where d.id = v_definition.id;
  return true;
end;
$$;
