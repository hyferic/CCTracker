-- Owner data, immutable business history, benefit-period history, and scheduler state.

create or replace function private.make_revision_snapshot(
  p_account_id uuid,
  p_name text,
  p_category text,
  p_description text,
  p_notes text,
  p_value_kind public.benefit_value_kind,
  p_benefit_amount numeric,
  p_currency text,
  p_unit_label text,
  p_minimum_spend numeric,
  p_cashback_percentage numeric,
  p_cashback_cap numeric,
  p_merchant text,
  p_merchant_category text,
  p_website text,
  p_tags text[],
  p_eligibility_notes text,
  p_enrollment_required boolean,
  p_enrollment_deadline date,
  p_effective_date date,
  p_end_date date,
  p_recurrence_type public.benefit_recurrence_type,
  p_recurrence_basis public.benefit_recurrence_basis,
  p_anchor_date date,
  p_interval_months integer,
  p_display_reset_date date,
  p_expiration_reminder_enabled boolean,
  p_reactivation_reminder_enabled boolean
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'account_id', p_account_id,
    'name', p_name,
    'category', p_category,
    'description', p_description,
    'notes', p_notes,
    'value_kind', p_value_kind,
    'benefit_amount', p_benefit_amount,
    'currency', p_currency,
    'unit_label', p_unit_label,
    'minimum_spend', p_minimum_spend,
    'cashback_percentage', p_cashback_percentage,
    'cashback_cap', p_cashback_cap,
    'merchant', p_merchant,
    'merchant_category', p_merchant_category,
    'website', p_website,
    'tags', to_jsonb(p_tags),
    'eligibility_notes', p_eligibility_notes,
    'enrollment_required', p_enrollment_required,
    'enrollment_deadline', p_enrollment_deadline,
    'effective_date', p_effective_date,
    'end_date', p_end_date,
    'recurrence_type', p_recurrence_type,
    'recurrence_basis', p_recurrence_basis,
    'anchor_date', p_anchor_date,
    'interval_months', p_interval_months,
    'display_reset_date', p_display_reset_date,
    'expiration_reminder_enabled', p_expiration_reminder_enabled,
    'reactivation_reminder_enabled', p_reactivation_reminder_enabled
  ));
$$;

revoke all on function private.make_revision_snapshot(
  uuid, text, text, text, text, public.benefit_value_kind, numeric, text,
  text, numeric, numeric, numeric, text, text, text, text[], text, boolean,
  date, date, date, public.benefit_recurrence_type,
  public.benefit_recurrence_basis, date, integer, date, boolean, boolean
) from public, anon, authenticated;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  notification_email text,
  timezone text not null default 'America/New_York',
  expiration_reminders_enabled boolean not null default true,
  reactivation_reminders_enabled boolean not null default true,
  recent_reset_days smallint not null default 7 check (recent_reset_days between 0 and 30),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint profiles_email_length check (length(email) between 3 and 320),
  constraint profiles_notification_email_shape check (
    notification_email is null or (
      length(notification_email) between 3 and 320
      and notification_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  )
);

create table public.accounts (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  display_name text not null,
  issuer text not null,
  card_service_name text,
  nickname text,
  last_four text,
  annual_fee numeric(14,2),
  annual_fee_currency text,
  renewal_date date,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (id, user_id),
  constraint accounts_display_name_length check (length(btrim(display_name)) between 1 and 160),
  constraint accounts_issuer_length check (length(btrim(issuer)) between 1 and 160),
  constraint accounts_card_service_name_length check (card_service_name is null or length(card_service_name) <= 160),
  constraint accounts_nickname_length check (nickname is null or length(nickname) <= 100),
  constraint accounts_last_four_format check (last_four is null or last_four ~ '^[0-9]{4}$'),
  constraint accounts_annual_fee_valid check (
    annual_fee is null or (annual_fee >= 0 and annual_fee = round(annual_fee, 2))
  ),
  constraint accounts_fee_currency_pair check (
    (annual_fee is null and annual_fee_currency is null)
    or (annual_fee is not null and annual_fee_currency ~ '^[A-Z]{3}$')
  ),
  constraint accounts_notes_length check (notes is null or length(notes) <= 10000)
);

create table public.benefit_definitions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  account_id uuid,
  name text not null,
  category text not null,
  description text,
  notes text,
  active boolean not null default true,
  recurrence_enabled boolean not null default false,
  value_kind public.benefit_value_kind not null,
  benefit_amount numeric(14,2),
  currency text,
  unit_label text,
  minimum_spend numeric(14,2),
  cashback_percentage numeric(7,4),
  cashback_cap numeric(14,2),
  merchant text,
  merchant_category text,
  website text,
  tags text[] not null default '{}',
  eligibility_notes text,
  enrollment_required boolean not null default false,
  enrollment_deadline date,
  enrolled_at date,
  effective_date date not null,
  end_date date,
  recurrence_type public.benefit_recurrence_type not null default 'one_time',
  recurrence_basis public.benefit_recurrence_basis not null default 'none',
  anchor_date date,
  interval_months integer,
  display_reset_date date,
  current_revision_no integer not null default 1 check (current_revision_no > 0),
  expiration_reminder_enabled boolean not null default true,
  reactivation_reminder_enabled boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (id, user_id),
  foreign key (account_id, user_id) references public.accounts(id, user_id),
  constraint benefit_definition_name_length check (length(btrim(name)) between 1 and 200),
  constraint benefit_definition_category_length check (length(btrim(category)) between 1 and 100),
  constraint benefit_definition_text_lengths check (
    (description is null or length(description) <= 10000)
    and (notes is null or length(notes) <= 10000)
    and (eligibility_notes is null or length(eligibility_notes) <= 20000)
    and (merchant is null or length(merchant) <= 300)
    and (merchant_category is null or length(merchant_category) <= 300)
    and (website is null or length(website) <= 2048)
    and coalesce(cardinality(tags), 0) <= 50
  ),
  constraint benefit_definition_website_format check (
    website is null or website ~* '^https?://[^[:space:]]+$'
  ),
  constraint benefit_definition_date_order check (end_date is null or end_date >= effective_date),
  constraint benefit_definition_display_reset_date check (
    display_reset_date is null or (
      recurrence_type <> 'one_time'
      and display_reset_date >= effective_date
      and (end_date is null or display_reset_date <= end_date)
    )
  ),
  constraint benefit_definition_one_time_end check (recurrence_type <> 'one_time' or end_date is not null),
  constraint benefit_definition_enrollment check (
    (not enrollment_required and enrollment_deadline is null)
    or enrollment_required
  ),
  constraint benefit_definition_value_shape check (
    benefit_amount is null or (benefit_amount > 0 and benefit_amount = round(benefit_amount, 2))
  ),
  constraint benefit_definition_minimum_spend check (
    minimum_spend is null or (minimum_spend >= 0 and minimum_spend = round(minimum_spend, 2))
  ),
  constraint benefit_definition_cashback_rate check (
    cashback_percentage is null or (cashback_percentage > 0 and cashback_percentage <= 100)
  ),
  constraint benefit_definition_cashback_cap check (
    cashback_cap is null or (cashback_cap > 0 and cashback_cap = round(cashback_cap, 2))
  ),
  constraint benefit_definition_currency_format check (currency is null or currency ~ '^[A-Z]{3}$'),
  constraint benefit_definition_value_combination check (
    (value_kind = 'money' and benefit_amount is not null and currency is not null
      and cashback_percentage is null and cashback_cap is null)
    or
    (value_kind = 'percentage_cashback' and cashback_percentage is not null and currency is not null
      and benefit_amount is null)
    or
    (value_kind in ('points', 'membership', 'other') and benefit_amount is not null
      and unit_label is not null and currency is null and cashback_percentage is null and cashback_cap is null
      and minimum_spend is null)
  ),
  constraint benefit_definition_points_whole check (
    value_kind <> 'points' or benefit_amount = trunc(benefit_amount)
  ),
  constraint benefit_definition_recurrence_shape check (
    (recurrence_type = 'one_time' and recurrence_basis = 'none'
      and anchor_date is null and interval_months is null and not recurrence_enabled)
    or
    (recurrence_type <> 'one_time' and (
      (recurrence_basis = 'calendar' and anchor_date is null and (
        (recurrence_type = 'monthly' and interval_months = 1)
        or (recurrence_type = 'quarterly' and interval_months = 3)
        or (recurrence_type = 'semiannual' and interval_months = 6)
        or (recurrence_type = 'annual' and interval_months = 12)
      ))
      or
      (recurrence_basis = 'anniversary' and anchor_date is not null and interval_months > 0 and (
        recurrence_type = 'custom'
        or (recurrence_type = 'monthly' and interval_months = 1)
        or (recurrence_type = 'quarterly' and interval_months = 3)
        or (recurrence_type = 'semiannual' and interval_months = 6)
        or (recurrence_type = 'annual' and interval_months = 12)
      ))
    ))
  )
);

create table public.benefit_definition_revisions (
  id uuid primary key default extensions.gen_random_uuid(),
  definition_id uuid not null,
  user_id uuid not null,
  revision_no integer not null check (revision_no > 0),
  valid_from date not null,
  valid_to date,
  account_id uuid,
  name text not null,
  category text not null,
  description text,
  notes text,
  value_kind public.benefit_value_kind not null,
  benefit_amount numeric(14,2),
  currency text,
  unit_label text,
  minimum_spend numeric(14,2),
  cashback_percentage numeric(7,4),
  cashback_cap numeric(14,2),
  merchant text,
  merchant_category text,
  website text,
  tags text[] not null default '{}',
  eligibility_notes text,
  enrollment_required boolean not null,
  enrollment_deadline date,
  effective_date date not null,
  end_date date,
  recurrence_type public.benefit_recurrence_type not null,
  recurrence_basis public.benefit_recurrence_basis not null,
  anchor_date date,
  interval_months integer,
  display_reset_date date,
  expiration_reminder_enabled boolean not null,
  reactivation_reminder_enabled boolean not null,
  business_snapshot jsonb generated always as (
    private.make_revision_snapshot(
      account_id, name, category, description, notes, value_kind, benefit_amount,
      currency, unit_label, minimum_spend, cashback_percentage, cashback_cap,
      merchant, merchant_category, website, tags, eligibility_notes,
      enrollment_required, enrollment_deadline, effective_date, end_date,
      recurrence_type, recurrence_basis, anchor_date, interval_months,
      display_reset_date,
      expiration_reminder_enabled, reactivation_reminder_enabled
    )
  ) stored,
  created_at timestamptz not null default statement_timestamp(),
  closed_at timestamptz,
  unique (id, user_id),
  unique (id, definition_id, user_id),
  unique (definition_id, revision_no),
  foreign key (definition_id, user_id) references public.benefit_definitions(id, user_id) on delete cascade,
  foreign key (account_id, user_id) references public.accounts(id, user_id),
  constraint benefit_revision_validity_order check (valid_to is null or valid_to >= valid_from),
  constraint benefit_revision_date_order check (end_date is null or end_date >= effective_date),
  constraint benefit_revision_display_reset_date check (
    display_reset_date is null or (
      recurrence_type <> 'one_time'
      and display_reset_date >= effective_date
      and (end_date is null or display_reset_date <= end_date)
    )
  ),
  constraint benefit_revision_one_time_end check (recurrence_type <> 'one_time' or end_date is not null),
  constraint benefit_revision_name_length check (length(btrim(name)) between 1 and 200),
  constraint benefit_revision_category_length check (length(btrim(category)) between 1 and 100),
  constraint benefit_revision_website_format check (
    website is null or website ~* '^https?://[^[:space:]]+$'
  ),
  constraint benefit_revision_value_shape check (
    benefit_amount is null or (benefit_amount > 0 and benefit_amount = round(benefit_amount, 2))
  ),
  constraint benefit_revision_minimum_spend check (
    minimum_spend is null or (minimum_spend >= 0 and minimum_spend = round(minimum_spend, 2))
  ),
  constraint benefit_revision_cashback_rate check (
    cashback_percentage is null or (cashback_percentage > 0 and cashback_percentage <= 100)
  ),
  constraint benefit_revision_cashback_cap check (
    cashback_cap is null or (cashback_cap > 0 and cashback_cap = round(cashback_cap, 2))
  ),
  constraint benefit_revision_currency_format check (currency is null or currency ~ '^[A-Z]{3}$'),
  constraint benefit_revision_value_combination check (
    (value_kind = 'money' and benefit_amount is not null and currency is not null
      and cashback_percentage is null and cashback_cap is null)
    or
    (value_kind = 'percentage_cashback' and cashback_percentage is not null and currency is not null
      and benefit_amount is null)
    or
    (value_kind in ('points', 'membership', 'other') and benefit_amount is not null
      and unit_label is not null and currency is null and cashback_percentage is null and cashback_cap is null
      and minimum_spend is null)
  ),
  constraint benefit_revision_points_whole check (
    value_kind <> 'points' or benefit_amount = trunc(benefit_amount)
  ),
  constraint benefit_revision_recurrence_shape check (
    (recurrence_type = 'one_time' and recurrence_basis = 'none'
      and anchor_date is null and interval_months is null)
    or
    (recurrence_type <> 'one_time' and (
      (recurrence_basis = 'calendar' and anchor_date is null and (
        (recurrence_type = 'monthly' and interval_months = 1)
        or (recurrence_type = 'quarterly' and interval_months = 3)
        or (recurrence_type = 'semiannual' and interval_months = 6)
        or (recurrence_type = 'annual' and interval_months = 12)
      ))
      or
      (recurrence_basis = 'anniversary' and anchor_date is not null and interval_months > 0 and (
        recurrence_type = 'custom'
        or (recurrence_type = 'monthly' and interval_months = 1)
        or (recurrence_type = 'quarterly' and interval_months = 3)
        or (recurrence_type = 'semiannual' and interval_months = 6)
        or (recurrence_type = 'annual' and interval_months = 12)
      ))
    ))
  )
);

create unique index benefit_revision_one_open
  on public.benefit_definition_revisions(definition_id)
  where valid_to is null;

alter table public.benefit_definition_revisions
  add constraint benefit_revision_ranges_do_not_overlap
  exclude using gist (
    definition_id with =,
    daterange(valid_from, valid_to, '[]') with &&
  ) deferrable initially immediate;

create table public.benefit_instances (
  id uuid primary key default extensions.gen_random_uuid(),
  definition_id uuid not null,
  revision_id uuid not null,
  user_id uuid not null,
  occurrence_key text not null,
  instance_version integer not null default 1 check (instance_version > 0),
  supersedes_instance_id uuid,
  recurrence_sequence integer not null default 0 check (recurrence_sequence >= 0),
  nominal_start date not null,
  nominal_end date not null,
  period_start date not null,
  period_end date not null,
  value_kind public.benefit_value_kind not null,
  available_quantity numeric(14,2),
  is_uncapped boolean not null default false,
  currency text,
  unit_label text not null,
  period_label text not null,
  generated_source public.instance_source not null,
  generated_at timestamptz not null default statement_timestamp(),
  reactivation_eligible boolean not null default false,
  expiration_notification_suppressed boolean not null default false,
  manual_completed_at timestamptz,
  manual_completion_note text,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default statement_timestamp(),
  unique (id, user_id),
  unique (id, definition_id, user_id),
  unique (definition_id, occurrence_key, instance_version),
  foreign key (definition_id, user_id) references public.benefit_definitions(id, user_id) on delete cascade,
  foreign key (revision_id, definition_id, user_id)
    references public.benefit_definition_revisions(id, definition_id, user_id),
  foreign key (supersedes_instance_id, definition_id, user_id)
    references public.benefit_instances(id, definition_id, user_id),
  constraint benefit_instance_occurrence_key_length check (length(occurrence_key) between 1 and 160),
  constraint benefit_instance_date_order check (
    nominal_end >= nominal_start
    and period_end >= period_start
    and period_start >= nominal_start
    and period_end <= nominal_end
  ),
  constraint benefit_instance_availability check (
    (is_uncapped and value_kind = 'percentage_cashback' and available_quantity is null)
    or
    (not is_uncapped and available_quantity is not null and available_quantity > 0
      and available_quantity = round(available_quantity, 2))
  ),
  constraint benefit_instance_points_whole check (
    value_kind <> 'points' or available_quantity = trunc(available_quantity)
  ),
  constraint benefit_instance_currency_shape check (
    (value_kind in ('money', 'percentage_cashback') and currency ~ '^[A-Z]{3}$')
    or
    (value_kind in ('points', 'membership', 'other') and currency is null)
  ),
  constraint benefit_instance_unit_label_length check (length(btrim(unit_label)) between 1 and 80),
  constraint benefit_instance_period_label_length check (length(btrim(period_label)) between 1 and 160),
  constraint benefit_instance_void_pair check (
    (voided_at is null and void_reason is null)
    or (voided_at is not null and length(btrim(void_reason)) between 1 and 1000)
  ),
  constraint benefit_instance_completion_pair check (
    (manual_completed_at is null and manual_completion_note is null)
    or (manual_completed_at is not null and is_uncapped)
  )
);

create unique index benefit_instance_one_live_occurrence
  on public.benefit_instances(definition_id, occurrence_key)
  where voided_at is null;

alter table public.benefit_instances
  add constraint benefit_instance_live_ranges_do_not_overlap
  exclude using gist (
    definition_id with =,
    daterange(period_start, period_end, '[]') with &&
  ) where (voided_at is null)
  deferrable initially immediate;

create table public.redemptions (
  id uuid primary key default extensions.gen_random_uuid(),
  benefit_instance_id uuid not null,
  user_id uuid not null,
  redeemed_quantity numeric(14,2) not null,
  used_date date not null,
  merchant text,
  transaction_description text,
  notes text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (id, user_id),
  foreign key (benefit_instance_id, user_id)
    references public.benefit_instances(id, user_id) on delete cascade,
  constraint redemption_quantity_positive check (
    redeemed_quantity > 0 and redeemed_quantity = round(redeemed_quantity, 2)
  ),
  constraint redemption_text_lengths check (
    (merchant is null or length(merchant) <= 300)
    and (transaction_description is null or length(transaction_description) <= 1000)
    and (notes is null or length(notes) <= 10000)
  )
);

create table public.notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  benefit_instance_id uuid not null,
  user_id uuid not null,
  notification_type public.notification_type not null,
  scheduled_for timestamptz not null,
  eligibility_date date not null,
  state public.notification_state not null default 'pending',
  recipient text,
  subject text,
  rendered_text text,
  rendered_html text,
  frozen_payload jsonb,
  frozen_payload_text text,
  payload_sha256 text,
  idempotency_key uuid,
  first_attempt_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  claim_token uuid,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz,
  last_error text,
  last_error_category text,
  provider_message_id text,
  provider_accepted_at timestamptz,
  delivery_state public.notification_delivery_state not null default 'unknown',
  superseded_by_instance_id uuid,
  superseded_by_notification_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (id, user_id),
  unique (benefit_instance_id, notification_type),
  unique (idempotency_key),
  foreign key (benefit_instance_id, user_id)
    references public.benefit_instances(id, user_id) on delete cascade,
  foreign key (superseded_by_instance_id, user_id)
    references public.benefit_instances(id, user_id),
  foreign key (superseded_by_notification_id, user_id)
    references public.notifications(id, user_id),
  constraint notification_schedule_order check (
    next_attempt_at is null or first_attempt_at is not null
  ),
  constraint notification_claim_pair check (
    (claim_token is null and claimed_at is null and lease_expires_at is null)
    or (claim_token is not null and claimed_at is not null and lease_expires_at > claimed_at)
  ),
  constraint notification_payload_freeze_shape check (
    (first_attempt_at is null and recipient is null and subject is null
      and rendered_text is null and rendered_html is null and frozen_payload is null
      and frozen_payload_text is null and payload_sha256 is null and idempotency_key is null
      and attempt_count = 0)
    or
    (first_attempt_at is not null and recipient is not null and subject is not null
      and rendered_text is not null and rendered_html is not null and frozen_payload is not null
      and frozen_payload_text is not null and payload_sha256 ~ '^[0-9a-f]{64}$'
      and idempotency_key is not null and attempt_count > 0)
  ),
  constraint notification_state_attempt_shape check (
    (state in ('pending', 'skipped', 'superseded') and first_attempt_at is null)
    or
    (state in ('processing', 'provider_accepted', 'definitive_failed',
      'retryable_failed', 'ambiguous', 'requires_review') and first_attempt_at is not null)
  ),
  constraint notification_provider_acceptance_shape check (
    (state <> 'provider_accepted')
    or (provider_accepted_at is not null and provider_message_id is not null)
  ),
  constraint notification_supersession_shape check (
    (state <> 'superseded')
    or superseded_by_instance_id is not null
  ),
  constraint notification_error_lengths check (
    (last_error is null or length(last_error) <= 2000)
    and (last_error_category is null or length(last_error_category) <= 100)
    and (provider_message_id is null or length(provider_message_id) <= 500)
  )
);

create table private.job_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  trigger_source text not null,
  started_at timestamptz not null default statement_timestamp(),
  finished_at timestamptz,
  heartbeat_at timestamptz not null default statement_timestamp(),
  processing_local_date_min date,
  processing_local_date_max date,
  counts jsonb not null default '{}'::jsonb,
  status private.job_run_status not null default 'running',
  sanitized_error text,
  constraint job_runs_trigger_length check (length(trigger_source) between 1 and 40),
  constraint job_runs_finish_shape check (
    (status = 'running' and finished_at is null)
    or (status <> 'running' and finished_at is not null)
  ),
  constraint job_runs_error_length check (sanitized_error is null or length(sanitized_error) <= 2000)
);

create table private.notification_attempts (
  id bigint generated always as identity primary key,
  notification_id uuid not null references public.notifications(id) on delete cascade,
  job_run_id uuid references private.job_runs(id) on delete set null,
  attempt_no integer not null check (attempt_no > 0),
  claim_token uuid not null,
  started_at timestamptz not null default statement_timestamp(),
  finished_at timestamptz,
  outcome text,
  error_category text,
  provider_message_id text,
  unique (notification_id, attempt_no),
  constraint notification_attempt_outcome_length check (outcome is null or length(outcome) <= 40),
  constraint notification_attempt_error_length check (error_category is null or length(error_category) <= 100)
);

create index accounts_user_active_idx on public.accounts(user_id, active);
create index benefit_definitions_user_active_idx on public.benefit_definitions(user_id, active);
create index benefit_definitions_account_idx on public.benefit_definitions(account_id) where account_id is not null;
create index benefit_revisions_definition_idx on public.benefit_definition_revisions(definition_id, revision_no);
create index benefit_instances_user_period_idx on public.benefit_instances(user_id, period_start, period_end) where voided_at is null;
create index redemptions_instance_idx on public.redemptions(benefit_instance_id, used_date);
create index notifications_due_idx on public.notifications(scheduled_for, next_attempt_at)
  where state in ('pending', 'retryable_failed', 'ambiguous', 'processing');
create index notifications_user_state_idx on public.notifications(user_id, state);
create index job_runs_status_idx on private.job_runs(status, started_at desc);

create trigger accounts_set_updated_at
before update on public.accounts
for each row execute function private.set_updated_at();

create trigger definitions_set_updated_at
before update on public.benefit_definitions
for each row execute function private.set_updated_at();

create trigger redemptions_set_updated_at
before update on public.redemptions
for each row execute function private.set_updated_at();

create trigger notifications_set_updated_at
before update on public.notifications
for each row execute function private.set_updated_at();
