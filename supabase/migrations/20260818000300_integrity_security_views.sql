-- Cross-row integrity, immutable audit contracts, owner isolation, and dashboard read model.

create or replace function private.sync_auth_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, email)
  values (new.id, coalesce(new.email, 'unknown@example.invalid'))
  on conflict (user_id) do update
    set email = excluded.email,
        updated_at = statement_timestamp();
  return new;
end;
$$;

revoke all on function private.sync_auth_profile() from public, anon, authenticated;

create trigger auth_user_profile_sync
after insert or update of email on auth.users
for each row execute function private.sync_auth_profile();

create or replace function private.protect_revision_history()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(current_setting('app.lifecycle_write', true), '') <> 'on' then
      raise exception 'revision inserts require a lifecycle transaction' using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if coalesce(current_setting('app.lifecycle_write', true), '') <> 'on'
       and pg_trigger_depth() <= 1 then
      raise exception 'revision history is immutable' using errcode = '42501';
    end if;
    return old;
  end if;

  if coalesce(current_setting('app.lifecycle_write', true), '') <> 'on'
     or old.valid_to is not null
     or new.valid_to is null
     or new.valid_to < old.valid_from
     or new.closed_at is null
     or (to_jsonb(new) - array['valid_to', 'closed_at', 'business_snapshot'])
        is distinct from
        (to_jsonb(old) - array['valid_to', 'closed_at', 'business_snapshot']) then
    raise exception 'revision rows are immutable except for one authorized close transition'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke all on function private.protect_revision_history() from public, anon, authenticated;

create trigger protect_revision_history
before insert or update or delete on public.benefit_definition_revisions
for each row execute function private.protect_revision_history();

create or replace function private.validate_revision_chain()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_definition_id uuid;
  v_open_count integer;
  v_open_revision integer;
  v_expected_revision integer;
  v_gap_count integer;
  v_bad_close_count integer;
  v_open_snapshot jsonb;
  v_definition_snapshot jsonb;
begin
  v_definition_id := case when tg_op = 'DELETE' then old.definition_id else new.definition_id end;
  if not exists (select 1 from public.benefit_definitions d where d.id = v_definition_id) then
    return null;
  end if;

  select count(*), max(r.revision_no) filter (where r.valid_to is null),
         (max(r.business_snapshot::text) filter (where r.valid_to is null))::jsonb
    into v_open_count, v_open_revision, v_open_snapshot
  from public.benefit_definition_revisions r
  where r.definition_id = v_definition_id
    and r.valid_to is null;

  select d.current_revision_no into v_expected_revision
  from public.benefit_definitions d
  where d.id = v_definition_id;

  if v_open_count <> 1 or v_open_revision is distinct from v_expected_revision then
    raise exception 'definition % must have exactly one matching open revision', v_definition_id
      using errcode = '23514';
  end if;

  select private.make_revision_snapshot(
    d.account_id, d.name, d.category, d.description, d.notes, d.value_kind,
    d.benefit_amount, d.currency, d.unit_label, d.minimum_spend,
    d.cashback_percentage, d.cashback_cap, d.merchant, d.merchant_category,
    d.website, d.tags, d.eligibility_notes, d.enrollment_required,
    d.enrollment_deadline, d.effective_date, d.end_date, d.recurrence_type,
    d.recurrence_basis, d.anchor_date, d.interval_months,
    d.display_reset_date,
    d.expiration_reminder_enabled, d.reactivation_reminder_enabled
  ) into v_definition_snapshot
  from public.benefit_definitions d where d.id = v_definition_id;

  if v_open_snapshot is distinct from v_definition_snapshot then
    raise exception 'definition % does not match its open immutable revision', v_definition_id
      using errcode = '23514';
  end if;

  select count(*) into v_gap_count
  from (
    select r.valid_from,
           lag(r.valid_to) over (order by r.valid_from, r.revision_no) as prior_valid_to,
           row_number() over (order by r.valid_from, r.revision_no) as position
    from public.benefit_definition_revisions r
    where r.definition_id = v_definition_id
  ) ordered
  where ordered.position > 1
    and ordered.valid_from <> ordered.prior_valid_to + 1;

  if v_gap_count <> 0 then
    raise exception 'revision ranges for definition % must be immediately adjacent', v_definition_id
      using errcode = '23514';
  end if;

  select count(*) into v_bad_close_count
  from public.benefit_definition_revisions r
  where r.definition_id = v_definition_id
    and ((r.valid_to is null) <> (r.closed_at is null));

  if v_bad_close_count <> 0 then
    raise exception 'closed revision metadata is inconsistent for definition %', v_definition_id
      using errcode = '23514';
  end if;

  return null;
end;
$$;

revoke all on function private.validate_revision_chain() from public, anon, authenticated;

create constraint trigger validate_revision_chain
after insert or update or delete on public.benefit_definition_revisions
deferrable initially deferred
for each row execute function private.validate_revision_chain();

create or replace function private.validate_redemption_total()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_instance_id uuid;
  v_available numeric;
  v_uncapped boolean;
  v_value_kind public.benefit_value_kind;
  v_period_start date;
  v_period_end date;
  v_total numeric;
  v_bad_rows integer;
begin
  if tg_table_name = 'redemptions' then
    v_instance_id := case when tg_op = 'DELETE'
      then old.benefit_instance_id else new.benefit_instance_id end;
  else
    v_instance_id := case when tg_op = 'DELETE' then old.id else new.id end;
  end if;

  select i.available_quantity, i.is_uncapped, i.value_kind, i.period_start, i.period_end
    into v_available, v_uncapped, v_value_kind, v_period_start, v_period_end
  from public.benefit_instances i
  where i.id = v_instance_id
  for update;

  if not found then
    return null;
  end if;

  select coalesce(sum(r.redeemed_quantity), 0),
         count(*) filter (
           where r.used_date < v_period_start
              or r.used_date > v_period_end
              or (v_value_kind = 'points' and r.redeemed_quantity <> trunc(r.redeemed_quantity))
         )
    into v_total, v_bad_rows
  from public.redemptions r
  where r.benefit_instance_id = v_instance_id;

  if v_bad_rows > 0 then
    raise exception 'redemption date or unit is incompatible with its benefit period'
      using errcode = '23514';
  end if;

  if not v_uncapped and v_total > v_available then
    raise exception 'redemptions (%) exceed available quantity (%)', v_total, v_available
      using errcode = '23514';
  end if;

  return null;
end;
$$;

revoke all on function private.validate_redemption_total() from public, anon, authenticated;

create constraint trigger validate_redemption_total_from_redemption
after insert or update or delete on public.redemptions
deferrable initially deferred
for each row execute function private.validate_redemption_total();

create constraint trigger validate_redemption_total_from_instance
after insert or update of available_quantity, is_uncapped, period_start, period_end on public.benefit_instances
deferrable initially deferred
for each row execute function private.validate_redemption_total();

create or replace function private.protect_notification_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.benefit_instance_id is distinct from old.benefit_instance_id
     or new.notification_type is distinct from old.notification_type then
    raise exception 'notification ownership and logical identity are immutable'
      using errcode = '55000';
  end if;

  if old.first_attempt_at is not null and (
    new.recipient is distinct from old.recipient
    or new.subject is distinct from old.subject
    or new.rendered_text is distinct from old.rendered_text
    or new.rendered_html is distinct from old.rendered_html
    or new.frozen_payload is distinct from old.frozen_payload
    or new.frozen_payload_text is distinct from old.frozen_payload_text
    or new.payload_sha256 is distinct from old.payload_sha256
    or new.idempotency_key is distinct from old.idempotency_key
    or new.first_attempt_at is distinct from old.first_attempt_at
    or new.scheduled_for is distinct from old.scheduled_for
    or new.eligibility_date is distinct from old.eligibility_date
  ) then
    raise exception 'attempted notification payload and idempotency identity are immutable'
      using errcode = '55000';
  end if;

  if new.attempt_count < old.attempt_count then
    raise exception 'notification attempt count cannot decrease' using errcode = '23514';
  end if;

  if old.state = 'provider_accepted' and (
    new.state <> 'provider_accepted'
    or new.provider_message_id is distinct from old.provider_message_id
    or new.provider_accepted_at is distinct from old.provider_accepted_at
  ) then
    raise exception 'provider acceptance is immutable' using errcode = '55000';
  end if;

  if old.state in ('definitive_failed', 'superseded') and new.state <> old.state then
    raise exception 'terminal notification state cannot be reopened' using errcode = '55000';
  end if;

  if new.superseded_by_instance_id is not null and not exists (
    select 1
    from public.benefit_instances original
    join public.benefit_instances replacement
      on replacement.id = new.superseded_by_instance_id
      and replacement.user_id = original.user_id
      and replacement.definition_id = original.definition_id
    where original.id = old.benefit_instance_id
      and original.user_id = old.user_id
  ) then
    raise exception 'notification replacement must belong to the same owner and definition'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.protect_notification_state() from public, anon, authenticated;

create trigger protect_notification_state
before update on public.notifications
for each row execute function private.protect_notification_state();

alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.benefit_definitions enable row level security;
alter table public.benefit_definition_revisions enable row level security;
alter table public.benefit_instances enable row level security;
alter table public.redemptions enable row level security;
alter table public.notifications enable row level security;

alter table public.profiles force row level security;
alter table public.accounts force row level security;
alter table public.benefit_definitions force row level security;
alter table public.benefit_definition_revisions force row level security;
alter table public.benefit_instances force row level security;
alter table public.redemptions force row level security;
alter table public.notifications force row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using ((select auth.uid()) = user_id);

create policy accounts_select_own on public.accounts
  for select to authenticated using ((select auth.uid()) = user_id);
create policy accounts_insert_own on public.accounts
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy accounts_update_own on public.accounts
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy accounts_delete_unreferenced_own on public.accounts
  for delete to authenticated
  using (
    (select auth.uid()) = user_id
    and not exists (
      select 1 from public.benefit_definitions d where d.account_id = accounts.id
    )
  );

create policy benefit_definitions_select_own on public.benefit_definitions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy benefit_revisions_select_own on public.benefit_definition_revisions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy benefit_instances_select_own on public.benefit_instances
  for select to authenticated using ((select auth.uid()) = user_id);
create policy redemptions_select_own on public.redemptions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy notifications_select_own on public.notifications
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

grant usage on schema public to authenticated;
grant select on public.profiles,
  public.accounts,
  public.benefit_definitions,
  public.benefit_definition_revisions,
  public.benefit_instances,
  public.redemptions,
  public.notifications to authenticated;

grant insert (user_id, display_name, issuer, card_service_name, nickname, last_four,
  annual_fee, annual_fee_currency, renewal_date, notes, active)
on public.accounts to authenticated;
grant update (display_name, issuer, card_service_name, nickname, last_four,
  annual_fee, annual_fee_currency, renewal_date, notes, active)
on public.accounts to authenticated;
grant delete on public.accounts to authenticated;

create or replace view public.benefit_instance_dashboard
with (security_invoker = true)
as
with base as (
  select
    i.id as instance_id,
    i.definition_id,
    i.revision_id,
    i.user_id,
    r.account_id,
    a.display_name as account_display_name,
    a.issuer as provider,
    r.name as benefit_name,
    r.category,
    r.description,
    r.notes,
    r.merchant,
    r.merchant_category,
    r.website,
    r.eligibility_notes,
    r.tags,
    d.active as definition_active,
    d.recurrence_enabled,
    r.recurrence_type,
    r.recurrence_basis,
    r.display_reset_date,
    r.enrollment_required,
    r.enrollment_deadline,
    d.enrolled_at,
    i.occurrence_key,
    i.instance_version,
    i.supersedes_instance_id,
    successor.superseded_by_instance_id,
    i.period_label,
    i.period_start,
    i.period_end,
    i.nominal_start,
    i.nominal_end,
    i.value_kind,
    r.cashback_percentage,
    r.minimum_spend,
    i.available_quantity,
    i.is_uncapped,
    i.currency,
    i.unit_label,
    i.reactivation_eligible,
    i.manual_completed_at,
    i.voided_at,
    i.void_reason,
    coalesce(redemption.total, 0::numeric) as redeemed_quantity,
    profile.local_today,
    profile.recent_reset_days
  from public.benefit_instances i
  join public.benefit_definitions d on d.id = i.definition_id and d.user_id = i.user_id
  join public.benefit_definition_revisions r
    on r.id = i.revision_id and r.definition_id = i.definition_id and r.user_id = i.user_id
  join public.profiles p on p.user_id = i.user_id
  left join public.accounts a on a.id = r.account_id and a.user_id = r.user_id
  left join lateral (
    select sum(r.redeemed_quantity) as total
    from public.redemptions r
    where r.benefit_instance_id = i.id and r.user_id = i.user_id
  ) redemption on true
  left join lateral (
    select newer.id as superseded_by_instance_id
    from public.benefit_instances newer
    where newer.supersedes_instance_id = i.id
      and newer.definition_id = i.definition_id
      and newer.user_id = i.user_id
    order by newer.instance_version desc, newer.created_at desc
    limit 1
  ) successor on true
  cross join lateral (
    select (statement_timestamp() at time zone p.timezone)::date as local_today,
           p.recent_reset_days
  ) profile
), calculated as (
  select
    base.*,
    case when base.is_uncapped then null
         else greatest(base.available_quantity - base.redeemed_quantity, 0)
    end as remaining_quantity,
    base.redeemed_quantity as earned_to_date,
    (base.period_end - base.local_today) as days_remaining,
    case
      when base.voided_at is not null then 'void'
      when base.local_today < base.period_start then 'upcoming'
      when base.local_today <= base.period_end then 'active'
      else 'expired'
    end as lifecycle_status,
    case
      when base.is_uncapped and base.manual_completed_at is not null then 'used'
      when base.is_uncapped and base.redeemed_quantity > 0 then 'partial'
      when base.is_uncapped then 'unused'
      when base.redeemed_quantity = 0 then 'unused'
      when base.redeemed_quantity >= base.available_quantity then 'used'
      else 'partial'
    end as usage_status
  from base
)
select
  c.instance_id,
  c.definition_id,
  c.revision_id,
  c.user_id,
  c.account_id,
  c.account_display_name,
  c.provider,
  c.benefit_name,
  c.category,
  c.description,
  c.notes,
  c.merchant,
  c.merchant_category,
  c.website,
  c.eligibility_notes,
  c.tags,
  c.definition_active,
  c.recurrence_enabled,
  c.recurrence_type,
  c.recurrence_basis,
  c.display_reset_date,
  c.enrollment_required,
  c.enrollment_deadline,
  c.enrolled_at,
  c.occurrence_key,
  c.instance_version,
  c.supersedes_instance_id,
  c.superseded_by_instance_id,
  c.period_label,
  c.period_start,
  c.period_end,
  c.nominal_start,
  c.nominal_end,
  c.value_kind,
  c.cashback_percentage,
  c.minimum_spend,
  c.available_quantity,
  c.redeemed_quantity,
  c.remaining_quantity,
  c.earned_to_date,
  c.is_uncapped,
  c.currency,
  c.unit_label,
  c.manual_completed_at as manually_completed_at,
  c.voided_at,
  c.void_reason,
  c.voided_at is null as is_live,
  c.voided_at is not null as is_audit_version,
  c.lifecycle_status,
  c.usage_status,
  c.days_remaining,
  c.lifecycle_status = 'active'
    and c.usage_status <> 'used'
    and c.days_remaining between 0 and 7 as expiring_in_7_days,
  c.lifecycle_status = 'active'
    and c.usage_status <> 'used'
    and c.days_remaining between 0 and 30 as expiring_in_30_days,
  c.lifecycle_status = 'active'
    and c.period_start between c.local_today - c.recent_reset_days and c.local_today as recently_activated,
  c.voided_at is null and c.definition_active and c.recurrence_enabled and exists (
    select 1
    from public.benefit_instances next_i
    where next_i.definition_id = c.definition_id
      and next_i.user_id = c.user_id
      and next_i.voided_at is null
      and next_i.period_start > c.local_today
      and next_i.period_start <= c.local_today + 7
  ) as reset_soon,
  c.enrollment_deadline - c.local_today as enrollment_days_remaining,
  c.voided_at is null
    and c.definition_active
    and c.enrollment_required
    and c.enrolled_at is null
    and c.enrollment_deadline is not null
    and c.enrollment_deadline < c.local_today as enrollment_missed,
  c.voided_at is null
    and c.definition_active
    and c.enrollment_required
    and c.enrolled_at is null
    and c.enrollment_deadline is not null
    and c.enrollment_deadline between c.local_today and c.local_today + 7
    as enrollment_due_7_days,
  c.voided_at is null
    and c.definition_active
    and c.enrollment_required
    and c.enrolled_at is null
    and c.enrollment_deadline is not null
    and c.enrollment_deadline between c.local_today + 8 and c.local_today + 30
    as enrollment_due_30_days,
  c.voided_at is null
    and c.definition_active
    and c.enrollment_required
    and c.enrolled_at is null
    and c.enrollment_deadline is not null
    and c.enrollment_deadline <= c.local_today + 30
    as enrollment_needs_attention,
  c.voided_at is null
    and c.definition_active
    and c.enrollment_required
    and c.enrolled_at is null
    and c.enrollment_deadline is not null
    and c.enrollment_deadline between c.local_today and c.local_today + 7 as enrollment_due,
  concat_ws(' ', c.benefit_name, c.account_display_name, c.provider, c.category,
    c.merchant, c.merchant_category, c.website, array_to_string(c.tags, ' '),
    c.description, c.notes, c.eligibility_notes) as search_text
from calculated c;

revoke all on public.benefit_instance_dashboard from public, anon;
grant select on public.benefit_instance_dashboard to authenticated;

-- Operational consumers use live periods only. The audit-capable dashboard view
-- remains available for explicitly labelled history/version screens.
create or replace view public.benefit_instance_overview
with (security_invoker = true)
as
select *
from public.benefit_instance_dashboard d
where d.is_live;

revoke all on public.benefit_instance_overview from public, anon;
grant select on public.benefit_instance_overview to authenticated;
