-- Close PostgreSQL's default function EXECUTE grant, then allow only exact APIs.

revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke execute on functions from public;
alter default privileges for role postgres in schema private
  revoke execute on functions from public;

grant execute on function public.update_profile_settings(jsonb) to authenticated;
grant execute on function public.create_benefit(jsonb, integer) to authenticated;
grant execute on function public.edit_benefit(uuid, jsonb, text, date) to authenticated;
grant execute on function public.set_recurrence_enabled(uuid, boolean) to authenticated;
grant execute on function public.set_benefit_active(uuid, boolean) to authenticated;
grant execute on function public.override_instance(uuid, jsonb, text) to authenticated;
grant execute on function public.record_redemption(uuid, numeric, date, text, text, text) to authenticated;
grant execute on function public.edit_redemption(uuid, numeric, date, text, text, text) to authenticated;
grant execute on function public.delete_redemption(uuid) to authenticated;
grant execute on function public.mark_uncapped_complete(uuid, text) to authenticated;
grant execute on function public.mark_finite_used(uuid, date, text, text, text) to authenticated;
grant execute on function public.delete_benefit_draft(uuid) to authenticated;
grant execute on function public.import_backup(jsonb, text, text) to authenticated;
grant execute on function public.scheduler_health() to authenticated;

grant usage on schema public to service_role;
grant execute on function public.scheduler_begin_run(text) to service_role;
grant execute on function public.scheduler_prepare_work(uuid, integer) to service_role;
grant execute on function public.scheduler_claim_notifications(uuid, integer, integer, text) to service_role;
grant execute on function public.scheduler_record_notification_outcome(uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.scheduler_heartbeat(uuid, jsonb) to service_role;
grant execute on function public.scheduler_finish_run(uuid, text, jsonb, text) to service_role;
grant execute on function public.scheduler_system_health() to service_role;

create or replace function private.install_notification_cron()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id bigint;
  v_existing bigint;
begin
  if not exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'scheduler_secret' and length(s.decrypted_secret) >= 32
  ) then
    raise exception 'Vault secret scheduler_secret is missing or too short' using errcode = '55000';
  end if;
  if not exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'process_notifications_url' and s.decrypted_secret like 'https://%'
  ) then
    raise exception 'Vault secret process_notifications_url is missing or invalid' using errcode = '55000';
  end if;

  for v_existing in
    select j.jobid from cron.job j where j.jobname = 'benefit-notification-processor'
  loop
    perform cron.unschedule(v_existing);
  end loop;

  select cron.schedule(
    'benefit-notification-processor',
    '7,22,37,52 * * * *',
    $command$
      select net.http_post(
        url := (
          select s.decrypted_secret from vault.decrypted_secrets s
          where s.name = 'process_notifications_url' limit 1
        ),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'X-Scheduler-Secret', (
            select s.decrypted_secret from vault.decrypted_secrets s
            where s.name = 'scheduler_secret' limit 1
          )
        ),
        body := '{"mode":"process","trigger":"cron"}'::jsonb,
        timeout_milliseconds := 120000
      );
    $command$
  ) into v_job_id;
  return v_job_id;
end;
$$;

revoke all on function private.install_notification_cron() from public, anon, authenticated;
grant execute on function private.install_notification_cron() to service_role;

-- A protected deployment bootstraps both named Vault secrets before applying this
-- migration. Local resets intentionally skip registration until test secrets exist.
do $$
begin
  if exists (select 1 from vault.decrypted_secrets s where s.name = 'scheduler_secret')
     and exists (select 1 from vault.decrypted_secrets s where s.name = 'process_notifications_url') then
    perform private.install_notification_cron();
  end if;
end;
$$;
