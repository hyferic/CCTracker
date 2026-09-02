-- Make dashboard confirmations reversible without confusing them with a
-- completion the user recorded separately, and protect the confirmation row
-- until the archived period is explicitly reopened.
alter table public.benefit_instances
  add column if not exists confirmation_manual_completion boolean not null default false;

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
  v_confirmation_manual_completion boolean := false;
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
    if v_instance.manual_completed_at is not null then
      raise exception 'benefit is already fully used' using errcode = '55000';
    end if;
    update public.benefit_instances i
    set manual_completed_at = statement_timestamp(),
        manual_completion_note = coalesce(nullif(btrim(p_note), ''), 'Confirmed used from dashboard.')
    where i.id = v_instance.id;
    v_confirmation_manual_completion := true;
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
        confirmation_manual_completion = v_confirmation_manual_completion,
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
  v_manual_completion boolean;
  v_legacy_candidate_count integer;
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

  -- The fallback makes archives created by the previous migration correctable
  -- while the explicit flag protects a pre-existing manual completion going
  -- forward.
  v_manual_completion := v_instance.confirmation_manual_completion
    or (v_instance.is_uncapped
      and v_instance.confirmation_redemption_id is null
      and v_instance.manual_completed_at is not null);
  if not v_manual_completion then
    if v_instance.confirmation_redemption_id is not null then
      v_redemption_id := coalesce(p_confirmation_redemption_id, v_instance.confirmation_redemption_id);
      if v_instance.confirmation_redemption_id is distinct from v_redemption_id then
        raise exception 'confirmation usage record is not available for correction' using errcode = '55000';
      end if;
    elsif v_instance.is_uncapped then
      if p_confirmation_redemption_id is not null then
        raise exception 'confirmation usage record is not available for correction' using errcode = '55000';
      end if;
    else
      -- The pre-marker RPC used this exact archive reason and dashboard note,
      -- and always inserted the final amount needed to reach the cap. Require
      -- one unambiguous candidate before deleting anything; an ordinary row
      -- with a matching note therefore fails closed rather than being guessed.
      select count(*) into v_legacy_candidate_count
      from public.redemptions candidate
      where candidate.benefit_instance_id = v_instance.id
        and candidate.user_id = v_user_id
        and candidate.notes in ('Confirmed used from dashboard.', 'Recorded from dashboard.')
        and candidate.redeemed_quantity = v_instance.available_quantity - (
          select coalesce(sum(previous.redeemed_quantity), 0)
          from public.redemptions previous
          where previous.benefit_instance_id = v_instance.id
            and previous.user_id = v_user_id
            and previous.id <> candidate.id
        );
      if v_legacy_candidate_count <> 1 then
        raise exception 'confirmation usage record is not available for correction' using errcode = '55000';
      end if;
      select candidate.id into v_redemption_id
      from public.redemptions candidate
      where candidate.benefit_instance_id = v_instance.id
        and candidate.user_id = v_user_id
        and candidate.notes in ('Confirmed used from dashboard.', 'Recorded from dashboard.')
        and candidate.redeemed_quantity = v_instance.available_quantity - (
          select coalesce(sum(previous.redeemed_quantity), 0)
          from public.redemptions previous
          where previous.benefit_instance_id = v_instance.id
            and previous.user_id = v_user_id
            and previous.id <> candidate.id
        )
      limit 1;
      if p_confirmation_redemption_id is not null
         and p_confirmation_redemption_id is distinct from v_redemption_id then
        raise exception 'confirmation usage record is not available for correction' using errcode = '55000';
      end if;
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
  end if;

  perform set_config('app.lifecycle_write', 'on', true);
  update public.benefit_instances i
  set confirmation_redemption_id = null,
      confirmation_manual_completion = false,
      manual_completed_at = case when v_manual_completion then null else i.manual_completed_at end,
      manual_completion_note = case when v_manual_completion then null else i.manual_completion_note end,
      voided_at = null,
      void_reason = null
  where i.id = v_instance.id
  returning * into v_instance;
  if not v_manual_completion then
    delete from public.redemptions r
    where r.id = v_redemption.id
      and r.benefit_instance_id = v_instance.id
      and r.user_id = v_user_id;
  end if;
  return v_instance;
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
  v_instance public.benefit_instances%rowtype;
begin
  select i.* into v_instance
  from public.redemptions r
  join public.benefit_instances i on i.id = r.benefit_instance_id
  where r.id = p_redemption_id and r.user_id = v_user_id
  for update of i;
  if not found then return false; end if;
  if v_instance.confirmation_redemption_id = p_redemption_id then
    raise exception 'confirmation usage record must be reopened through the correction action'
      using errcode = '55000';
  end if;
  delete from public.redemptions r where r.id = p_redemption_id and r.user_id = v_user_id;
  return found;
end;
$$;

revoke all on function public.confirm_benefit_period_used(uuid, date, text) from public, anon;
grant execute on function public.confirm_benefit_period_used(uuid, date, text) to authenticated;
revoke all on function public.reopen_confirmed_benefit_period(uuid, uuid) from public, anon;
grant execute on function public.reopen_confirmed_benefit_period(uuid, uuid) to authenticated;
revoke all on function public.delete_redemption(uuid) from public, anon;
grant execute on function public.delete_redemption(uuid) to authenticated;
