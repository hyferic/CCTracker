-- Transactional, owner-rekeyed canonical JSON restore. Notification authority is never imported.

create or replace function public.import_backup(
  p_backup jsonb,
  p_duplicate_policy text,
  p_current_notification_policy text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_authenticated_user();
  v_item jsonb;
  v_old_id text;
  v_new_id uuid;
  v_definition_id uuid;
  v_revision_id uuid;
  v_instance_id uuid;
  v_account_id uuid;
  v_interval integer;
  v_generated integer;
  v_total_rows integer;
  v_accounts integer := 0;
  v_definitions integer := 0;
  v_revisions integer := 0;
  v_materialized_revisions integer := 0;
  v_instances integer := 0;
  v_materialized_instances integer := 0;
  v_redemptions integer := 0;
  v_skipped integer := 0;
  v_current_revision integer;
  v_source_definition boolean;
  v_map record;
begin
  if p_backup is null or jsonb_typeof(p_backup) <> 'object' then
    raise exception 'backup must be a JSON object' using errcode = '22023';
  end if;
  if pg_catalog.octet_length(p_backup::text) > 5 * 1024 * 1024 then
    raise exception 'backup exceeds the 5 MiB limit' using errcode = '54000';
  end if;
  if coalesce(p_backup->>'schema_version', '') <> '1' then
    raise exception 'unsupported backup schema version' using errcode = '22023';
  end if;
  if p_duplicate_policy not in ('skip', 'import_as_new') then
    raise exception 'duplicate policy must be skip or import_as_new' using errcode = '22023';
  end if;
  if p_current_notification_policy not in ('suppress_current', 'schedule_fresh') then
    raise exception 'notification policy must be suppress_current or schedule_fresh' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_backup->'accounts', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_backup->'definitions', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_backup->'revisions', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_backup->'instances', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_backup->'redemptions', '[]'::jsonb)) <> 'array' then
    raise exception 'backup collections must be arrays' using errcode = '22023';
  end if;

  v_total_rows := jsonb_array_length(coalesce(p_backup->'accounts', '[]'::jsonb))
    + jsonb_array_length(coalesce(p_backup->'definitions', '[]'::jsonb))
    + jsonb_array_length(coalesce(p_backup->'revisions', '[]'::jsonb))
    + jsonb_array_length(coalesce(p_backup->'instances', '[]'::jsonb))
    + jsonb_array_length(coalesce(p_backup->'redemptions', '[]'::jsonb));
  if v_total_rows > 5000 then
    raise exception 'backup exceeds the 5,000 row limit' using errcode = '54000';
  end if;

  -- plpgsql_check cannot infer temp-table shapes created inside a function.
  -- These string expressions are checker pragmas and harmless no-ops at runtime.
  perform 'PRAGMA:TABLE: pg_temp.import_account_map(old_id text, new_id uuid, skipped boolean)';
  perform 'PRAGMA:TABLE: pg_temp.import_definition_map(old_id text, new_id uuid, skipped boolean)';
  perform 'PRAGMA:TABLE: pg_temp.import_revision_map(old_id text, new_id uuid)';
  perform 'PRAGMA:TABLE: pg_temp.import_instance_map(old_id text, new_id uuid, old_supersedes_id text, old_confirmation_redemption_id text)';
  perform 'PRAGMA:TABLE: pg_temp.import_redemption_map(old_id text, new_id uuid, old_instance_id text)';
  perform 'PRAGMA:TABLE: pg_temp.import_skipped_instances(old_id text)';

  drop table if exists pg_temp.import_account_map;
  drop table if exists pg_temp.import_definition_map;
  drop table if exists pg_temp.import_revision_map;
  drop table if exists pg_temp.import_instance_map;
  drop table if exists pg_temp.import_redemption_map;
  drop table if exists pg_temp.import_skipped_instances;

  create temporary table pg_temp.import_account_map (
    old_id text primary key,
    new_id uuid not null,
    skipped boolean not null default false
  ) on commit drop;
  create temporary table pg_temp.import_definition_map (
    old_id text primary key,
    new_id uuid not null,
    skipped boolean not null default false
  ) on commit drop;
  create temporary table pg_temp.import_revision_map (
    old_id text primary key,
    new_id uuid not null
  ) on commit drop;
  create temporary table pg_temp.import_instance_map (
    old_id text primary key,
    new_id uuid not null,
    old_supersedes_id text,
    old_confirmation_redemption_id text
  ) on commit drop;
  create temporary table pg_temp.import_redemption_map (
    old_id text primary key,
    new_id uuid not null,
    old_instance_id text not null
  ) on commit drop;
  create temporary table pg_temp.import_skipped_instances (
    old_id text primary key
  ) on commit drop;

  for v_item in select value from jsonb_array_elements(coalesce(p_backup->'accounts', '[]'::jsonb)) loop
    if jsonb_typeof(v_item) <> 'object' or nullif(v_item->>'id', '') is null then
      raise exception 'every account requires a source id' using errcode = '22023';
    end if;
    v_old_id := v_item->>'id';
    if nullif(v_item->>'annual_fee', '') is not null
       and scale((v_item->>'annual_fee')::numeric) > 2 then
      raise exception 'annual_fee accepts at most two fractional digits' using errcode = '22023';
    end if;
    v_new_id := null;
    if p_duplicate_policy = 'skip' then
      select a.id into v_new_id from public.accounts a
      where a.user_id = v_user_id
        and lower(a.display_name) = lower(btrim(v_item->>'display_name'))
        and lower(a.issuer) = lower(btrim(v_item->>'issuer'))
      order by a.created_at limit 1;
    end if;

    if v_new_id is not null then
      insert into pg_temp.import_account_map values (v_old_id, v_new_id, true);
      v_skipped := v_skipped + 1;
    else
      insert into public.accounts (
        user_id, display_name, issuer, card_service_name, nickname, last_four,
        annual_fee, annual_fee_currency, renewal_date, notes, active
      ) values (
        v_user_id, btrim(v_item->>'display_name'), btrim(v_item->>'issuer'),
        nullif(btrim(v_item->>'card_service_name'), ''), nullif(btrim(v_item->>'nickname'), ''),
        nullif(v_item->>'last_four', ''), nullif(v_item->>'annual_fee', '')::numeric,
        nullif(upper(v_item->>'annual_fee_currency'), ''), nullif(v_item->>'renewal_date', '')::date,
        nullif(v_item->>'notes', ''), coalesce((v_item->>'active')::boolean, true)
      ) returning id into v_new_id;
      insert into pg_temp.import_account_map values (v_old_id, v_new_id, false);
      v_accounts := v_accounts + 1;
    end if;
  end loop;

  perform set_config('app.lifecycle_write', 'on', true);
  for v_item in select value from jsonb_array_elements(coalesce(p_backup->'definitions', '[]'::jsonb)) loop
    perform private.assert_benefit_payload(v_item - array['id','user_id','current_revision_no','created_at','updated_at']);
    if nullif(v_item->>'id', '') is null then
      raise exception 'every definition requires a source id' using errcode = '22023';
    end if;
    v_old_id := v_item->>'id';
    v_account_id := null;
    if nullif(v_item->>'account_id', '') is not null then
      select m.new_id into v_account_id from pg_temp.import_account_map m
      where m.old_id = v_item->>'account_id';
      if not found then raise exception 'definition references an unknown account' using errcode = '23503'; end if;
    end if;

    v_new_id := null;
    if p_duplicate_policy = 'skip' then
      select d.id into v_new_id from public.benefit_definitions d
      where d.user_id = v_user_id
        and lower(d.name) = lower(btrim(v_item->>'name'))
        and d.effective_date = (v_item->>'effective_date')::date
        and d.account_id is not distinct from v_account_id
      order by d.created_at limit 1;
    end if;
    if v_new_id is not null then
      insert into pg_temp.import_definition_map values (v_old_id, v_new_id, true);
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_interval := case coalesce(v_item->>'recurrence_type', 'one_time')
      when 'monthly' then 1 when 'quarterly' then 3 when 'semiannual' then 6
      when 'annual' then 12 when 'custom' then (v_item->>'interval_months')::integer else null end;
    select coalesce(nullif(v_item->>'current_revision_no', '')::integer,
      (select max((revision->>'revision_no')::integer)
       from jsonb_array_elements(coalesce(p_backup->'revisions', '[]'::jsonb)) revision
       where revision->>'definition_id' = v_old_id), 1)
    into v_current_revision;

    insert into public.benefit_definitions (
      user_id, account_id, name, category, description, notes, active,
      recurrence_enabled, value_kind, benefit_amount, currency, unit_label,
      minimum_spend, cashback_percentage, cashback_cap, merchant, merchant_category,
      website, tags, eligibility_notes, enrollment_required, enrollment_deadline,
      enrolled_at, effective_date, end_date, recurrence_type, recurrence_basis,
      anchor_date, interval_months, display_reset_date, current_revision_no,
      expiration_reminder_enabled, reactivation_reminder_enabled
    ) values (
      v_user_id, v_account_id, btrim(v_item->>'name'), btrim(v_item->>'category'),
      nullif(v_item->>'description', ''), nullif(v_item->>'notes', ''),
      coalesce((v_item->>'active')::boolean, true),
      case when coalesce(v_item->>'recurrence_type', 'one_time') = 'one_time' then false
        else coalesce((v_item->>'recurrence_enabled')::boolean, true) end,
      (v_item->>'value_kind')::public.benefit_value_kind,
      nullif(v_item->>'benefit_amount', '')::numeric, nullif(upper(v_item->>'currency'), ''),
      nullif(v_item->>'unit_label', ''), nullif(v_item->>'minimum_spend', '')::numeric,
      nullif(v_item->>'cashback_percentage', '')::numeric, nullif(v_item->>'cashback_cap', '')::numeric,
      nullif(v_item->>'merchant', ''), nullif(v_item->>'merchant_category', ''),
      nullif(v_item->>'website', ''),
      case when jsonb_typeof(v_item->'tags') = 'array'
        then array(select jsonb_array_elements_text(v_item->'tags')) else '{}'::text[] end,
      nullif(v_item->>'eligibility_notes', ''), coalesce((v_item->>'enrollment_required')::boolean, false),
      nullif(v_item->>'enrollment_deadline', '')::date, nullif(v_item->>'enrolled_at', '')::date,
      (v_item->>'effective_date')::date, nullif(v_item->>'end_date', '')::date,
      coalesce(v_item->>'recurrence_type', 'one_time')::public.benefit_recurrence_type,
      coalesce(v_item->>'recurrence_basis', case when coalesce(v_item->>'recurrence_type', 'one_time') = 'one_time'
        then 'none' else 'calendar' end)::public.benefit_recurrence_basis,
      nullif(v_item->>'anchor_date', '')::date, v_interval,
      nullif(v_item->>'display_reset_date', '')::date, v_current_revision,
      coalesce((v_item->>'expiration_reminder_enabled')::boolean, true),
      coalesce((v_item->>'reactivation_reminder_enabled')::boolean, true)
    ) returning id into v_new_id;
    insert into pg_temp.import_definition_map values (v_old_id, v_new_id, false);
    v_definitions := v_definitions + 1;
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_backup->'revisions', '[]'::jsonb))
    order by (value->>'revision_no')::integer
  loop
    select m.new_id, m.skipped into v_definition_id, v_source_definition
    from pg_temp.import_definition_map m where m.old_id = v_item->>'definition_id';
    if not found then raise exception 'revision references an unknown definition' using errcode = '23503'; end if;
    if v_source_definition then continue; end if;
    if nullif(v_item->>'id', '') is null then raise exception 'every revision requires a source id' using errcode = '22023'; end if;
    if (nullif(v_item->>'benefit_amount', '') is not null and scale((v_item->>'benefit_amount')::numeric) > 2)
       or (nullif(v_item->>'minimum_spend', '') is not null and scale((v_item->>'minimum_spend')::numeric) > 2)
       or (nullif(v_item->>'cashback_cap', '') is not null and scale((v_item->>'cashback_cap')::numeric) > 2) then
      raise exception 'revision fiat values accept at most two fractional digits' using errcode = '22023';
    end if;
    v_account_id := null;
    if nullif(v_item->>'account_id', '') is not null then
      select m.new_id into v_account_id from pg_temp.import_account_map m where m.old_id = v_item->>'account_id';
      if not found then raise exception 'revision references an unknown account' using errcode = '23503'; end if;
    end if;

    insert into public.benefit_definition_revisions (
      definition_id, user_id, revision_no, valid_from, valid_to, closed_at,
      account_id, name, category, description, notes, value_kind, benefit_amount,
      currency, unit_label, minimum_spend, cashback_percentage, cashback_cap,
      merchant, merchant_category, website, tags, eligibility_notes,
      enrollment_required, enrollment_deadline, effective_date, end_date,
      recurrence_type, recurrence_basis, anchor_date, interval_months, display_reset_date,
      expiration_reminder_enabled, reactivation_reminder_enabled
    ) values (
      v_definition_id, v_user_id, (v_item->>'revision_no')::integer,
      (v_item->>'valid_from')::date, nullif(v_item->>'valid_to', '')::date,
      case when nullif(v_item->>'valid_to', '') is null then null else statement_timestamp() end,
      v_account_id, btrim(v_item->>'name'), btrim(v_item->>'category'),
      nullif(v_item->>'description', ''), nullif(v_item->>'notes', ''),
      (v_item->>'value_kind')::public.benefit_value_kind,
      nullif(v_item->>'benefit_amount', '')::numeric, nullif(upper(v_item->>'currency'), ''),
      nullif(v_item->>'unit_label', ''), nullif(v_item->>'minimum_spend', '')::numeric,
      nullif(v_item->>'cashback_percentage', '')::numeric, nullif(v_item->>'cashback_cap', '')::numeric,
      nullif(v_item->>'merchant', ''), nullif(v_item->>'merchant_category', ''),
      nullif(v_item->>'website', ''),
      case when jsonb_typeof(v_item->'tags') = 'array'
        then array(select jsonb_array_elements_text(v_item->'tags')) else '{}'::text[] end,
      nullif(v_item->>'eligibility_notes', ''), coalesce((v_item->>'enrollment_required')::boolean, false),
      nullif(v_item->>'enrollment_deadline', '')::date, (v_item->>'effective_date')::date,
      nullif(v_item->>'end_date', '')::date,
      (v_item->>'recurrence_type')::public.benefit_recurrence_type,
      (v_item->>'recurrence_basis')::public.benefit_recurrence_basis,
      nullif(v_item->>'anchor_date', '')::date, nullif(v_item->>'interval_months', '')::integer,
      nullif(v_item->>'display_reset_date', '')::date,
      coalesce((v_item->>'expiration_reminder_enabled')::boolean, true),
      coalesce((v_item->>'reactivation_reminder_enabled')::boolean, true)
    ) returning id into v_revision_id;
    insert into pg_temp.import_revision_map values (v_item->>'id', v_revision_id);
    v_revisions := v_revisions + 1;
  end loop;

  -- A canonical export normally has revisions. Accept a definition-only backup
  -- by constructing its first immutable revision from the validated master row.
  for v_map in
    select m.old_id, m.new_id
    from pg_temp.import_definition_map m
    where not m.skipped and not exists (
      select 1 from public.benefit_definition_revisions r where r.definition_id = m.new_id
    )
  loop
    update public.benefit_definitions d set current_revision_no = 1 where d.id = v_map.new_id;
    v_revision_id := private.insert_revision_from_definition(v_map.new_id,
      (select d.effective_date - 1 from public.benefit_definitions d where d.id = v_map.new_id));
    insert into pg_temp.import_revision_map values ('generated:' || v_map.old_id, v_revision_id);
    v_revisions := v_revisions + 1;
    v_materialized_revisions := v_materialized_revisions + 1;
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_backup->'instances', '[]'::jsonb)) loop
    if nullif(v_item->>'id', '') is null then raise exception 'every instance requires a source id' using errcode = '22023'; end if;
    select m.new_id, m.skipped into v_definition_id, v_source_definition
    from pg_temp.import_definition_map m where m.old_id = v_item->>'definition_id';
    if not found then raise exception 'instance references an unknown definition' using errcode = '23503'; end if;
    if v_source_definition then
      insert into pg_temp.import_skipped_instances values (v_item->>'id');
      continue;
    end if;
    if nullif(v_item->>'available_quantity', '') is not null
       and scale((v_item->>'available_quantity')::numeric) > 2 then
      raise exception 'instance availability accepts at most two fractional digits' using errcode = '22023';
    end if;
    select m.new_id into v_revision_id from pg_temp.import_revision_map m where m.old_id = v_item->>'revision_id';
    if not found then raise exception 'instance references an unknown revision' using errcode = '23503'; end if;

    insert into public.benefit_instances (
      definition_id, revision_id, user_id, occurrence_key, instance_version,
      recurrence_sequence, nominal_start, nominal_end, period_start, period_end,
      value_kind, available_quantity, is_uncapped, currency, unit_label, period_label,
      generated_source, reactivation_eligible, expiration_notification_suppressed,
      manual_completed_at, manual_completion_note, confirmation_redemption_id,
      confirmation_manual_completion, voided_at, void_reason
    ) values (
      v_definition_id, v_revision_id, v_user_id, v_item->>'occurrence_key',
      coalesce(nullif(v_item->>'instance_version', '')::integer, 1),
      coalesce(nullif(v_item->>'recurrence_sequence', '')::integer, 0),
      (v_item->>'nominal_start')::date, (v_item->>'nominal_end')::date,
      (v_item->>'period_start')::date, (v_item->>'period_end')::date,
      (v_item->>'value_kind')::public.benefit_value_kind,
      nullif(v_item->>'available_quantity', '')::numeric,
      coalesce((v_item->>'is_uncapped')::boolean, false), nullif(upper(v_item->>'currency'), ''),
      btrim(v_item->>'unit_label'), btrim(v_item->>'period_label'), 'import', false,
      p_current_notification_policy = 'suppress_current',
      case when nullif(v_item->>'manual_completed_at', '') is null then null else statement_timestamp() end,
      nullif(v_item->>'manual_completion_note', ''),
      null,
      coalesce((v_item->>'confirmation_manual_completion')::boolean, false),
      case when nullif(v_item->>'voided_at', '') is null then null else statement_timestamp() end,
      case when nullif(v_item->>'voided_at', '') is null then null
        else coalesce(nullif(v_item->>'void_reason', ''), 'Restored void audit version') end
    ) returning id into v_instance_id;
    insert into pg_temp.import_instance_map values (
      v_item->>'id', v_instance_id, nullif(v_item->>'supersedes_instance_id', ''),
      nullif(v_item->>'confirmation_redemption_id', '')
    );
    v_instances := v_instances + 1;
  end loop;

  -- Account/definition-only imports (including validated CSV converted by the
  -- client to schema-versioned JSON) still need usable periods. Generate them
  -- through the same calendar/anniversary engine, but never infer that a
  -- restored period is eligible for a reactivation email.
  for v_map in
    select m.new_id, d.effective_date, d.interval_months,
      private.local_today(v_user_id) as local_today
    from pg_temp.import_definition_map m
    join public.benefit_definitions d on d.id = m.new_id and d.user_id = v_user_id
    where not m.skipped
      and not exists (
        select 1 from public.benefit_instances i where i.definition_id = m.new_id
      )
  loop
    v_generated := private.materialize_definition(
      v_map.new_id,
      v_map.local_today,
      greatest(
        v_map.local_today + 31,
        (v_map.local_today + make_interval(months => coalesce(v_map.interval_months, 0)))::date,
        v_map.effective_date
      ),
      'import', false, false
    );

    if v_total_rows + v_materialized_revisions + v_materialized_instances + v_generated > 5000 then
      raise exception 'materialized import exceeds the 5,000 row limit' using errcode = '54000';
    end if;

    if p_current_notification_policy = 'suppress_current' and v_generated > 0 then
      update public.benefit_instances i
      set expiration_notification_suppressed = true
      where i.definition_id = v_map.new_id
        and i.generated_source = 'import';
    end if;

    v_instances := v_instances + v_generated;
    v_materialized_instances := v_materialized_instances + v_generated;
  end loop;

  update public.benefit_instances i set supersedes_instance_id = prior.new_id
  from pg_temp.import_instance_map current_map
  join pg_temp.import_instance_map prior on prior.old_id = current_map.old_supersedes_id
  where i.id = current_map.new_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_backup->'redemptions', '[]'::jsonb)) loop
    if scale((v_item->>'redeemed_quantity')::numeric) > 2 then
      raise exception 'redemption quantity accepts at most two fractional digits' using errcode = '22023';
    end if;
    select m.new_id into v_instance_id from pg_temp.import_instance_map m
    where m.old_id = v_item->>'benefit_instance_id';
    if not found then
      if exists (select 1 from pg_temp.import_skipped_instances s
        where s.old_id = v_item->>'benefit_instance_id') then continue; end if;
      raise exception 'redemption references an unknown instance' using errcode = '23503';
    end if;
    insert into public.redemptions (
      benefit_instance_id, user_id, redeemed_quantity, used_date,
      merchant, transaction_description, notes
    ) values (
      v_instance_id, v_user_id, (v_item->>'redeemed_quantity')::numeric,
      (v_item->>'used_date')::date, nullif(v_item->>'merchant', ''),
      nullif(v_item->>'transaction_description', ''), nullif(v_item->>'notes', '')
    ) returning id into v_new_id;
    if nullif(v_item->>'id', '') is not null then
      insert into pg_temp.import_redemption_map(old_id, new_id, old_instance_id)
      values (v_item->>'id', v_new_id, v_item->>'benefit_instance_id');
    end if;
    v_redemptions := v_redemptions + 1;
  end loop;

  -- Confirmation IDs refer to source redemption IDs, so resolve them only
  -- after all destination redemptions exist and require the source instance
  -- relationship to match. Missing or cross-instance references fail closed.
  for v_map in
    select m.old_id, m.new_id, m.old_confirmation_redemption_id
    from pg_temp.import_instance_map m
    where m.old_confirmation_redemption_id is not null
  loop
    select r.new_id into v_new_id
    from pg_temp.import_redemption_map r
    where r.old_id = v_map.old_confirmation_redemption_id
      and r.old_instance_id = v_map.old_id;
    if not found then
      raise exception 'confirmation redemption references an unknown or mismatched redemption'
        using errcode = '23503';
    end if;
    update public.benefit_instances i
    set confirmation_redemption_id = v_new_id
    where i.id = v_map.new_id;
  end loop;

  set constraints all immediate;
  set constraints all deferred;

  return jsonb_build_object(
    'accounts_imported', v_accounts,
    'definitions_imported', v_definitions,
    'revisions_imported', v_revisions,
    'instances_imported', v_instances,
    'instances_materialized', v_materialized_instances,
    'redemptions_imported', v_redemptions,
    'duplicates_skipped', v_skipped,
    'notification_policy', p_current_notification_policy
  );
end;
$$;
