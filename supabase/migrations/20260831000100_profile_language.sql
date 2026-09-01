alter table public.profiles
  add column if not exists language text;

alter table public.profiles
  add constraint profiles_language_supported check (language is null or language in ('en', 'zh-CN'));

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
      'reactivation_reminders_enabled','recent_reset_days','language'])
  ) then
    raise exception 'settings contain unsupported fields' using errcode = '22023';
  end if;
  v_timezone := case when p_settings ? 'timezone' then p_settings->>'timezone'
    else (select p.timezone from public.profiles p where p.user_id = v_user_id) end;
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
      select lower(u.email) into v_confirmed_email from auth.users u
      where u.id = v_user_id and u.email_confirmed_at is not null;
      if v_confirmed_email is null or v_notification_email <> v_confirmed_email then
        raise exception 'notification email must match the confirmed authentication email in v1'
          using errcode = '22023';
      end if;
    end if;
  end if;
  if p_settings ? 'language' and p_settings->>'language' not in ('en', 'zh-CN') then
    raise exception 'unsupported language' using errcode = '22023';
  end if;
  update public.profiles p set
    notification_email = case when p_settings ? 'notification_email' then v_notification_email else p.notification_email end,
    timezone = v_timezone,
    expiration_reminders_enabled = case when p_settings ? 'expiration_reminders_enabled' then (p_settings->>'expiration_reminders_enabled')::boolean else p.expiration_reminders_enabled end,
    reactivation_reminders_enabled = case when p_settings ? 'reactivation_reminders_enabled' then (p_settings->>'reactivation_reminders_enabled')::boolean else p.reactivation_reminders_enabled end,
    recent_reset_days = case when p_settings ? 'recent_reset_days' then (p_settings->>'recent_reset_days')::smallint else p.recent_reset_days end,
    language = case when p_settings ? 'language' then p_settings->>'language' else p.language end,
    updated_at = statement_timestamp()
  where p.user_id = v_user_id returning p.* into v_result;
  return v_result;
end;
$$;

revoke all on function public.update_profile_settings(jsonb) from public, anon;
grant execute on function public.update_profile_settings(jsonb) to authenticated;
