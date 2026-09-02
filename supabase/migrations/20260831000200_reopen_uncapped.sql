create or replace function public.reopen_uncapped_benefit(p_instance_id uuid)
returns public.benefit_instances
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_authenticated_user();
  v_result public.benefit_instances%rowtype;
begin
  select * into v_result
  from public.benefit_instances i
  where i.id = p_instance_id
    and i.user_id = v_user_id
    and i.voided_at is null
  for update;

  if not found then
    raise exception 'live benefit instance not found' using errcode = 'P0002';
  end if;
  if not v_result.is_uncapped then
    raise exception 'only uncapped cashback can be reopened' using errcode = '22023';
  end if;

  update public.benefit_instances i
  set manual_completed_at = null,
      manual_completion_note = null
  where i.id = v_result.id
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.reopen_uncapped_benefit(uuid) from public, anon;
grant execute on function public.reopen_uncapped_benefit(uuid) to authenticated;
