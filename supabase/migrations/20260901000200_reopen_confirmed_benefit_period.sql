-- Keep the redemption created by a dashboard confirmation identifiable so an
-- undo can remove that row without touching earlier usage history.
alter table public.benefit_instances
  add column if not exists confirmation_redemption_id uuid;

-- Used one-time periods can only be corrected through their redemption history,
-- never through an instance override.
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
  where i.id = p_instance_id and i.user_id = v_user_id and i.voided_at is null;
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
  if v_redeemed > 0 and exists (
    select 1 from public.benefit_definition_revisions r
    where r.id = v_old.revision_id
      and r.definition_id = v_old.definition_id
      and r.user_id = v_user_id
      and r.recurrence_type = 'one_time'
  ) then
    raise exception 'used one-time period cannot be overridden; correct the redemption instead'
      using errcode = '55000';
  end if;
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

-- Return the redemption created by a full confirmation. Recurring instances
-- remain live and use the normal redemption-delete correction path; one-time
-- instances keep the id as a private marker for the atomic reopen operation.
create or replace function public.confirm_benefit_period_used(
  p_instance_id uuid,
  p_used_date date,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_authenticated_user();
  v_instance public.benefit_instances%rowtype;
  v_definition public.benefit_definitions%rowtype;
  v_revision public.benefit_definition_revisions%rowtype;
  v_redemption public.redemptions%rowtype;
  v_remaining numeric;
  v_generated integer := 0;
  v_archived boolean := false;
  v_confirmation_redemption_id uuid;
begin
  select * into v_instance
  from public.benefit_instances i
  where i.id = p_instance_id and i.user_id = v_user_id and i.voided_at is null
  for update;
  if not found then
    raise exception 'live benefit instance not found' using errcode = 'P0002';
  end if;
  if p_used_date is null or p_used_date not between v_instance.period_start and v_instance.period_end then
    raise exception 'used date must be within the benefit period' using errcode = '22023';
  end if;

  select * into v_definition
  from public.benefit_definitions d
  where d.id = v_instance.definition_id and d.user_id = v_user_id
  for update;
  select * into v_revision
  from public.benefit_definition_revisions r
  where r.id = v_instance.revision_id
    and r.definition_id = v_instance.definition_id
    and r.user_id = v_user_id;
  if not found then
    raise exception 'benefit revision not found' using errcode = 'P0002';
  end if;

  if v_instance.is_uncapped then
    if v_instance.manual_completed_at is null then
      update public.benefit_instances i
      set manual_completed_at = statement_timestamp(),
          manual_completion_note = coalesce(nullif(btrim(p_note), ''), 'Confirmed used from dashboard.')
      where i.id = v_instance.id;
    end if;
  else
    select v_instance.available_quantity - coalesce(sum(r.redeemed_quantity), 0)
      into v_remaining
    from public.redemptions r
    where r.benefit_instance_id = v_instance.id;
    if v_remaining <= 0 then
      raise exception 'benefit is already fully used' using errcode = '55000';
    end if;
    select * into v_redemption
    from public.record_redemption(v_instance.id, v_remaining, p_used_date,
      null, null, p_note);
    v_confirmation_redemption_id := v_redemption.id;
  end if;

  if v_revision.recurrence_type = 'one_time' then
    perform set_config('app.lifecycle_write', 'on', true);
    update public.benefit_instances i
    set confirmation_redemption_id = v_confirmation_redemption_id,
        voided_at = statement_timestamp(),
        void_reason = 'Confirmed used; archived from dashboard'
    where i.id = v_instance.id;
    update public.notifications n
    set state = 'skipped', next_attempt_at = null
    where n.benefit_instance_id = v_instance.id
      and n.first_attempt_at is null
      and n.state <> 'superseded';
    v_archived := true;
  else
    v_generated := private.materialize_definition(
      v_definition.id,
      v_instance.period_end + 1,
      greatest(
        v_instance.period_end + 1,
        (v_instance.period_end + make_interval(months => v_definition.interval_months))::date
      ),
      'scheduler', false, false
    );
  end if;

  return jsonb_build_object(
    'instance_id', v_instance.id,
    'archived', v_archived,
    'generated_instances', v_generated,
    'confirmation_redemption_id', v_confirmation_redemption_id
  );
end;
$$;

revoke all on function public.confirm_benefit_period_used(uuid, date, text) from public, anon;
grant execute on function public.confirm_benefit_period_used(uuid, date, text) to authenticated;

drop function if exists public.reopen_confirmed_benefit_period(uuid);

-- Explicit correction path for the dashboard's one-time confirmation archive.
create or replace function public.reopen_confirmed_benefit_period(
  p_instance_id uuid,
  p_confirmation_redemption_id uuid default null
)
returns public.benefit_instances
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_authenticated_user();
  v_instance public.benefit_instances%rowtype;
  v_redemption public.redemptions%rowtype;
  v_redemption_id uuid;
begin
  select * into v_instance
  from public.benefit_instances i
  where i.id = p_instance_id
    and i.user_id = v_user_id
    and i.voided_at is not null
    and i.void_reason = 'Confirmed used; archived from dashboard'
  for update;
  if not found then
    raise exception 'confirmed one-time period not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1
    from public.benefit_definition_revisions r
    where r.id = v_instance.revision_id
      and r.definition_id = v_instance.definition_id
      and r.user_id = v_user_id
      and r.recurrence_type = 'one_time'
  ) then
    raise exception 'only one-time confirmations can be reopened' using errcode = '22023';
  end if;
  v_redemption_id := coalesce(p_confirmation_redemption_id, v_instance.confirmation_redemption_id);
  if v_redemption_id is null
     or v_instance.confirmation_redemption_id is distinct from v_redemption_id then
    raise exception 'confirmation usage record is not available for correction' using errcode = '55000';
  end if;
  select * into v_redemption
  from public.redemptions r
  where r.id = v_redemption_id
    and r.benefit_instance_id = v_instance.id
    and r.user_id = v_user_id
  for update;
  if not found then
    raise exception 'confirmation usage record not found' using errcode = 'P0002';
  end if;

  perform set_config('app.lifecycle_write', 'on', true);
  update public.benefit_instances i
  set confirmation_redemption_id = null,
      voided_at = null,
      void_reason = null
  where i.id = v_instance.id
  returning * into v_instance;
  delete from public.redemptions r
  where r.id = v_redemption.id
    and r.benefit_instance_id = v_instance.id
    and r.user_id = v_user_id;
  return v_instance;
end;
$$;

revoke all on function public.reopen_confirmed_benefit_period(uuid, uuid) from public, anon;
grant execute on function public.reopen_confirmed_benefit_period(uuid, uuid) to authenticated;
