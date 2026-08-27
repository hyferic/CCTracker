-- Atomically confirm the current period from a dashboard shortcut.
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
  v_remaining numeric;
  v_generated integer := 0;
  v_archived boolean := false;
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
    perform public.record_redemption(v_instance.id, v_remaining, p_used_date,
      null, null, p_note);
  end if;

  if v_revision.recurrence_type = 'one_time' then
    perform set_config('app.lifecycle_write', 'on', true);
    update public.benefit_instances i
    set voided_at = statement_timestamp(),
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
    'generated_instances', v_generated
  );
end;
$$;

revoke all on function public.confirm_benefit_period_used(uuid, date, text) from public, anon;
grant execute on function public.confirm_benefit_period_used(uuid, date, text) to authenticated;
