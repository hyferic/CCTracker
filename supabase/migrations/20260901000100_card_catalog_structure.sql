-- Extend the existing versioned catalog with structured, auditable metadata.
--
-- This migration deliberately retains the existing product/template tables and
-- content_hash values. Existing account provenance points at those hashes, so
-- changing them would make otherwise valid historical data look untrusted.
-- structured_content_hash covers the new normalized fields instead.

create or replace function private.catalog_urls_valid(p_urls text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(cardinality(p_urls), 0) > 0
    and not exists (
      select 1
      from unnest(p_urls) as url
      where url is null
        or btrim(url) = ''
        or url !~ '^https://[^[:space:]]+$'
    );
$$;

revoke all on function private.catalog_urls_valid(text[]) from public, anon, authenticated;

alter table private.card_catalog_product_versions
  add column if not exists card_type text not null default 'consumer',
  add column if not exists official_product_url text,
  add column if not exists official_source_urls text[] not null default '{}',
  add column if not exists verification_state text not null default 'pending',
  add column if not exists effective_from date,
  add column if not exists effective_to date,
  add column if not exists verification_notes text not null default '',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists structured_content_hash text generated always as (
    pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          coalesce(stable_key, '') || '|' || coalesce(version::text, '') || '|'
            || coalesce(issuer, '') || '|' || coalesce(product_name, '') || '|'
            || coalesce(card_type, '') || '|' || coalesce(market_scope, '') || '|'
            || coalesce(annual_fee::text, '') || '|' || coalesce(annual_fee_currency, '') || '|'
            || coalesce(official_product_url, '') || '|'
            || coalesce(array_to_string(official_source_urls, ','), '') || '|'
            || coalesce(verification_state, '') || '|'
            || coalesce(effective_from::text, '') || '|' || coalesce(effective_to::text, '') || '|'
            || coalesce(verification_notes, '') || '|' || coalesce(metadata::text, ''),
          'UTF8'),
        'sha256'),
      'hex')
  ) stored;

alter table private.card_catalog_template_versions
  add column if not exists benefit_description text,
  add column if not exists benefit_value numeric(14,2),
  add column if not exists benefit_currency text,
  add column if not exists benefit_unit text,
  add column if not exists structured_recurrence_type public.benefit_recurrence_type,
  add column if not exists structured_recurrence_basis public.benefit_recurrence_basis,
  add column if not exists reset_strategy text,
  add column if not exists activation_required boolean not null default false,
  add column if not exists eligibility jsonb not null default '{}'::jsonb,
  add column if not exists limits jsonb not null default '{}'::jsonb,
  add column if not exists merchant_scope text[] not null default '{}',
  add column if not exists official_source_urls text[] not null default '{}',
  add column if not exists verification_state text not null default 'pending',
  add column if not exists effective_from date,
  add column if not exists effective_to date,
  add column if not exists verification_notes text not null default '',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists structured_content_hash text generated always as (
    pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          coalesce(stable_key, '') || '|' || coalesce(version::text, '') || '|'
            || coalesce(product_version_id::text, '') || '|' || coalesce(name, '') || '|'
            || coalesce(benefit_description, '') || '|' || coalesce(benefit_value::text, '') || '|'
            || coalesce(benefit_currency, '') || '|' || coalesce(benefit_unit, '') || '|'
            || coalesce(structured_recurrence_type::text, '') || '|'
            || coalesce(structured_recurrence_basis::text, '') || '|'
            || coalesce(reset_strategy, '') || '|' || coalesce(activation_required::text, '') || '|'
            || coalesce(eligibility::text, '') || '|' || coalesce(limits::text, '') || '|'
            || coalesce(array_to_string(merchant_scope, ','), '') || '|'
            || coalesce(array_to_string(official_source_urls, ','), '') || '|'
            || coalesce(verification_state, '') || '|' || coalesce(effective_from::text, '') || '|'
            || coalesce(effective_to::text, '') || '|' || coalesce(verification_notes, '') || '|'
            || coalesce(metadata::text, ''),
          'UTF8'),
        'sha256'),
      'hex')
  ) stored;

-- Normalize the existing seed rows. These values are derived only from the
-- already-installed catalog payload and are not a claim of a fresh issuer
-- review. The new state is intentionally pending/limited/contingent.
update private.card_catalog_product_versions
set card_type = 'consumer',
    official_product_url = case
      when official_url !~ '/card-benefits/' then official_url
      else null
    end,
    official_source_urls = array[official_url],
    verification_state = 'pending',
    effective_from = coalesce(effective_from, verified_on),
    verification_notes = case
      when verification_notes = '' then
        'Retained from the existing catalog seed; latest issuer terms require independent re-check.'
      else verification_notes
    end
where official_source_urls = '{}'
   or effective_from is null
   or verification_state = 'pending'
   or verification_notes = '';

-- Co-branded cards are still consumer products, but the distinction matters
-- when users compare or import a catalog row. Keep the classification explicit
-- without changing any existing benefit payloads.
update private.card_catalog_product_versions
set card_type = 'co_branded'
where stable_key in (
  'hilton-honors-aspire', 'marriott-bonvoy-brilliant', 'united-explorer',
  'southwest-rapid-rewards-priority', 'delta-skymiles-reserve'
);

update private.card_catalog_template_versions
set benefit_description = coalesce(nullif(payload->>'description', ''), summary),
    benefit_value = nullif(payload->>'benefit_amount', '')::numeric,
    benefit_currency = nullif(upper(payload->>'currency'), ''),
    benefit_unit = nullif(payload->>'unit_label', ''),
    structured_recurrence_type = (payload->>'recurrence_type')::public.benefit_recurrence_type,
    structured_recurrence_basis = (payload->>'recurrence_basis')::public.benefit_recurrence_basis,
    reset_strategy = date_strategy,
    activation_required = coalesce((payload->>'enrollment_required')::boolean, false),
    eligibility = jsonb_strip_nulls(jsonb_build_object(
      'merchant', payload->'merchant',
      'merchant_category', payload->'merchant_category',
      'eligibility_notes', payload->'eligibility_notes',
      'enrollment_required', coalesce(payload->'enrollment_required', 'false'::jsonb),
      'minimum_spend', payload->'minimum_spend'
    )),
    limits = jsonb_strip_nulls(jsonb_build_object(
      'minimum_spend', payload->'minimum_spend',
      'period_value_rules', coalesce(payload->'period_value_rules', '[]'::jsonb),
      'fixed_start', fixed_start,
      'fixed_end', fixed_end
    )),
    merchant_scope = case
      when nullif(payload->>'merchant', '') is null then '{}'
      else array[payload->>'merchant']
    end,
    official_source_urls = array[official_url],
    verification_state = case
      when confidence = 'contingent' then 'contingent'
      when confidence = 'limited' then 'limited'
      else 'pending'
    end,
    effective_from = coalesce(effective_from, fixed_start, verified_on),
    effective_to = coalesce(effective_to, fixed_end),
    verification_notes = case
      when verification_notes = '' then
        'Retained from the existing catalog seed; latest issuer terms require independent re-check.'
      else verification_notes
    end
where benefit_description is null
   or benefit_value is null
   or structured_recurrence_type is null
   or structured_recurrence_basis is null
   or reset_strategy is null
   or official_source_urls = '{}'
   or verification_notes = '';

-- The original high confidence labels were authored by the seed migration, not
-- independently re-verified by this extension. Keep the legacy column useful
-- without allowing it to overstate the new verification state.
update private.card_catalog_template_versions
set confidence = 'limited'
where confidence = 'high';

alter table private.card_catalog_product_versions
  alter column effective_from set not null;

alter table private.card_catalog_template_versions
  alter column benefit_description set not null,
  alter column structured_recurrence_type set not null,
  alter column structured_recurrence_basis set not null,
  alter column reset_strategy set not null,
  alter column effective_from set not null;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint
    where conname = 'card_catalog_product_card_type'
      and conrelid = 'private.card_catalog_product_versions'::regclass) then
    alter table private.card_catalog_product_versions
      add constraint card_catalog_product_card_type
      check (card_type in ('consumer', 'business', 'student', 'secured', 'co_branded', 'charge', 'other'));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint
    where conname = 'card_catalog_product_product_url'
      and conrelid = 'private.card_catalog_product_versions'::regclass) then
    alter table private.card_catalog_product_versions
      add constraint card_catalog_product_product_url
      check (official_product_url is null or official_product_url ~ '^https://[^[:space:]]+$');
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint
    where conname = 'card_catalog_product_sources'
      and conrelid = 'private.card_catalog_product_versions'::regclass) then
    alter table private.card_catalog_product_versions
      add constraint card_catalog_product_sources
      check (private.catalog_urls_valid(official_source_urls));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint
    where conname = 'card_catalog_product_verification_state'
      and conrelid = 'private.card_catalog_product_versions'::regclass) then
    alter table private.card_catalog_product_versions
      add constraint card_catalog_product_verification_state
      check (verification_state in ('verified', 'limited', 'pending', 'contingent'));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint
    where conname = 'card_catalog_product_effective_range'
      and conrelid = 'private.card_catalog_product_versions'::regclass) then
    alter table private.card_catalog_product_versions
      add constraint card_catalog_product_effective_range
      check (effective_to is null or effective_to >= effective_from);
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint
    where conname = 'card_catalog_product_metadata_object'
      and conrelid = 'private.card_catalog_product_versions'::regclass) then
    alter table private.card_catalog_product_versions
      add constraint card_catalog_product_metadata_object
      check (jsonb_typeof(metadata) = 'object');
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint
    where conname = 'card_catalog_product_verified_complete'
      and conrelid = 'private.card_catalog_product_versions'::regclass) then
    alter table private.card_catalog_product_versions
      add constraint card_catalog_product_verified_complete
      check (verification_state <> 'verified'
        or (official_product_url is not null and private.catalog_urls_valid(official_source_urls)));
  end if;

  if not exists (select 1 from pg_catalog.pg_constraint
    where conname = 'card_catalog_template_sources'
      and conrelid = 'private.card_catalog_template_versions'::regclass) then
    alter table private.card_catalog_template_versions
      add constraint card_catalog_template_sources
      check (private.catalog_urls_valid(official_source_urls));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint
    where conname = 'card_catalog_template_verification_state'
      and conrelid = 'private.card_catalog_template_versions'::regclass) then
    alter table private.card_catalog_template_versions
      add constraint card_catalog_template_verification_state
      check (verification_state in ('verified', 'limited', 'pending', 'contingent'));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint
    where conname = 'card_catalog_template_effective_range'
      and conrelid = 'private.card_catalog_template_versions'::regclass) then
    alter table private.card_catalog_template_versions
      add constraint card_catalog_template_effective_range
      check (effective_to is null or effective_to >= effective_from);
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint
    where conname = 'card_catalog_template_description'
      and conrelid = 'private.card_catalog_template_versions'::regclass) then
    alter table private.card_catalog_template_versions
      add constraint card_catalog_template_description
      check (length(btrim(benefit_description)) between 1 and 20000);
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint
    where conname = 'card_catalog_template_value_shape'
      and conrelid = 'private.card_catalog_template_versions'::regclass) then
    alter table private.card_catalog_template_versions
      add constraint card_catalog_template_value_shape
      check (benefit_value is null or (benefit_value > 0 and benefit_value = round(benefit_value, 2)));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint
    where conname = 'card_catalog_template_currency_shape'
      and conrelid = 'private.card_catalog_template_versions'::regclass) then
    alter table private.card_catalog_template_versions
      add constraint card_catalog_template_currency_shape
      check (benefit_currency is null or benefit_currency ~ '^[A-Z]{3}$');
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint
    where conname = 'card_catalog_template_unit_shape'
      and conrelid = 'private.card_catalog_template_versions'::regclass) then
    alter table private.card_catalog_template_versions
      add constraint card_catalog_template_unit_shape
      check (benefit_unit is null or length(btrim(benefit_unit)) between 1 and 160);
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint
    where conname = 'card_catalog_template_value_combination'
      and conrelid = 'private.card_catalog_template_versions'::regclass) then
    alter table private.card_catalog_template_versions
      add constraint card_catalog_template_value_combination
      check (
        benefit_value is null
        or (payload->>'value_kind' = 'money' and benefit_currency is not null)
        or (payload->>'value_kind' in ('points', 'membership', 'other')
          and benefit_unit is not null)
      );
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint
    where conname = 'card_catalog_template_points_whole'
      and conrelid = 'private.card_catalog_template_versions'::regclass) then
    alter table private.card_catalog_template_versions
      add constraint card_catalog_template_points_whole
      check (payload->>'value_kind' <> 'points' or benefit_value is null or benefit_value = trunc(benefit_value));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint
    where conname = 'card_catalog_template_recurrence_shape'
      and conrelid = 'private.card_catalog_template_versions'::regclass) then
    alter table private.card_catalog_template_versions
      add constraint card_catalog_template_recurrence_shape
      check (
        (structured_recurrence_type = 'one_time' and structured_recurrence_basis = 'none')
        or (structured_recurrence_type <> 'one_time'
          and structured_recurrence_basis in ('calendar', 'anniversary'))
      );
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint
    where conname = 'card_catalog_template_json_objects'
      and conrelid = 'private.card_catalog_template_versions'::regclass) then
    alter table private.card_catalog_template_versions
      add constraint card_catalog_template_json_objects
      check (jsonb_typeof(eligibility) = 'object'
        and jsonb_typeof(limits) = 'object'
        and jsonb_typeof(metadata) = 'object');
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint
    where conname = 'card_catalog_template_verified_complete'
      and conrelid = 'private.card_catalog_template_versions'::regclass) then
    alter table private.card_catalog_template_versions
      add constraint card_catalog_template_verified_complete
      check (verification_state <> 'verified' or (
        benefit_value is not null
        and private.catalog_urls_valid(official_source_urls)
        and ((payload->>'value_kind' = 'money' and benefit_currency is not null)
          or (payload->>'value_kind' in ('points', 'membership', 'other')
            and benefit_unit is not null))
      ));
  end if;
end;
$$;

-- Keep payload and normalized columns from silently drifting apart on future
-- catalog imports. Existing lifecycle APIs continue to use their old payload.
create or replace function private.validate_catalog_template_structure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload_amount numeric;
begin
  if new.payload is null or pg_catalog.jsonb_typeof(new.payload) <> 'object' then
    raise exception 'catalog payload must be a JSON object' using errcode = '22023';
  end if;
  begin
    v_payload_amount := nullif(new.payload->>'benefit_amount', '')::numeric;
  exception when invalid_text_representation then
    raise exception 'catalog payload benefit_amount must be numeric' using errcode = '22023';
  end;
  if new.benefit_value is distinct from v_payload_amount then
    raise exception 'catalog payload and structured benefit_value differ' using errcode = '22023';
  end if;
  if new.benefit_description is distinct from
      coalesce(nullif(new.payload->>'description', ''), new.summary) then
    raise exception 'catalog payload and structured benefit_description differ' using errcode = '22023';
  end if;
  if new.benefit_currency is distinct from nullif(upper(new.payload->>'currency'), '') then
    raise exception 'catalog payload and structured benefit_currency differ' using errcode = '22023';
  end if;
  if new.benefit_unit is distinct from nullif(new.payload->>'unit_label', '') then
    raise exception 'catalog payload and structured benefit_unit differ' using errcode = '22023';
  end if;
  if new.structured_recurrence_type::text is distinct from
      coalesce(new.payload->>'recurrence_type', 'one_time') then
    raise exception 'catalog payload and structured recurrence_type differ' using errcode = '22023';
  end if;
  if new.structured_recurrence_basis::text is distinct from
      coalesce(new.payload->>'recurrence_basis', 'none') then
    raise exception 'catalog payload and structured recurrence_basis differ' using errcode = '22023';
  end if;
  if new.reset_strategy is distinct from new.date_strategy then
    raise exception 'catalog date strategy and reset strategy differ' using errcode = '22023';
  end if;
  if new.activation_required is distinct from coalesce((new.payload->>'enrollment_required')::boolean, false) then
    raise exception 'catalog payload and activation_required differ' using errcode = '22023';
  end if;
  if new.eligibility is distinct from jsonb_strip_nulls(jsonb_build_object(
      'merchant', new.payload->'merchant',
      'merchant_category', new.payload->'merchant_category',
      'eligibility_notes', new.payload->'eligibility_notes',
      'enrollment_required', coalesce(new.payload->'enrollment_required', 'false'::jsonb),
      'minimum_spend', new.payload->'minimum_spend')) then
    raise exception 'catalog payload and structured eligibility differ' using errcode = '22023';
  end if;
  if new.limits is distinct from jsonb_strip_nulls(jsonb_build_object(
      'minimum_spend', new.payload->'minimum_spend',
      'period_value_rules', coalesce(new.payload->'period_value_rules', '[]'::jsonb),
      'fixed_start', new.fixed_start,
      'fixed_end', new.fixed_end)) then
    raise exception 'catalog payload and structured limits differ' using errcode = '22023';
  end if;
  if new.merchant_scope is distinct from case
      when nullif(new.payload->>'merchant', '') is null then '{}'
      else array[new.payload->>'merchant']
    end then
    raise exception 'catalog payload and structured merchant_scope differ' using errcode = '22023';
  end if;
  if not (new.official_url = any(new.official_source_urls)) then
    raise exception 'catalog official_url must be retained in official_source_urls'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function private.validate_catalog_template_structure() from public, anon, authenticated;
drop trigger if exists validate_catalog_template_structure
  on private.card_catalog_template_versions;
create trigger validate_catalog_template_structure
before insert or update on private.card_catalog_template_versions
for each row execute function private.validate_catalog_template_structure();

create table if not exists private.card_catalog_source_documents (
  id uuid primary key default extensions.gen_random_uuid(),
  source_key text not null unique,
  issuer text not null,
  source_kind text not null check (source_kind in ('product', 'benefit_terms', 'issuer_terms', 'other')),
  url text not null unique check (url ~ '^https://[^[:space:]]+$'),
  title text,
  verification_state text not null default 'pending'
    check (verification_state in ('verified', 'limited', 'pending', 'contingent')),
  verified_on date not null,
  notes text not null default '',
  created_at timestamptz not null default statement_timestamp()
);

create table if not exists private.card_catalog_product_sources (
  product_version_id uuid not null references private.card_catalog_product_versions(id) on delete cascade,
  source_id uuid not null references private.card_catalog_source_documents(id) on delete restrict,
  source_role text not null check (source_role in ('official_product', 'issuer_reference')),
  primary key (product_version_id, source_id)
);

create table if not exists private.card_catalog_template_sources (
  template_version_id uuid not null references private.card_catalog_template_versions(id) on delete cascade,
  source_id uuid not null references private.card_catalog_source_documents(id) on delete restrict,
  source_role text not null check (source_role in ('official_benefit_terms', 'issuer_reference')),
  primary key (template_version_id, source_id)
);

revoke all on private.card_catalog_source_documents,
  private.card_catalog_product_sources,
  private.card_catalog_template_sources
  from public, anon, authenticated;

insert into private.card_catalog_source_documents
  (source_key, issuer, source_kind, url, title, verification_state, verified_on, notes)
select
  'existing-' || md5(p.url),
  min(p.issuer),
  case
    when p.url ~ '/card-benefits/' or p.url ~ '/card-benefits' then 'benefit_terms'
    when p.url ~ 'offer-details' then 'issuer_terms'
    else 'product'
  end,
  p.url,
  'Existing catalog source',
  'pending',
  max(p.verified_on),
  'Existing issuer URL retained from the catalog seed; current terms require independent re-check.'
from (
  select issuer, official_url as url, verified_on
  from private.card_catalog_product_versions
  union all
  select p.issuer, t.official_url, t.verified_on
  from private.card_catalog_template_versions t
  join private.card_catalog_product_versions p on p.id = t.product_version_id
) p
group by p.url
on conflict (url) do update set
  issuer = excluded.issuer,
  source_kind = excluded.source_kind,
  verification_state = 'pending',
  verified_on = excluded.verified_on,
  notes = excluded.notes;

insert into private.card_catalog_product_sources (product_version_id, source_id, source_role)
select p.id, s.id,
  case when p.official_product_url = s.url then 'official_product' else 'issuer_reference' end
from private.card_catalog_product_versions p
join private.card_catalog_source_documents s on s.url = any(p.official_source_urls)
on conflict (product_version_id, source_id) do update set source_role = excluded.source_role;

insert into private.card_catalog_template_sources (template_version_id, source_id, source_role)
select t.id, s.id,
  case when t.official_url = s.url then 'official_benefit_terms' else 'issuer_reference' end
from private.card_catalog_template_versions t
join private.card_catalog_source_documents s on s.url = any(t.official_source_urls)
on conflict (template_version_id, source_id) do update set source_role = excluded.source_role;

create index if not exists card_catalog_source_documents_issuer_idx
  on private.card_catalog_source_documents (issuer, source_kind);
create index if not exists card_catalog_product_sources_source_idx
  on private.card_catalog_product_sources (source_id);
create index if not exists card_catalog_template_sources_source_idx
  on private.card_catalog_template_sources (source_id);

create table if not exists private.card_catalog_target_issuers (
  issuer_key text primary key,
  issuer_name text not null unique,
  in_scope boolean not null default true,
  notes text not null default '',
  created_at timestamptz not null default statement_timestamp(),
  check (length(btrim(issuer_key)) between 1 and 80),
  check (length(btrim(issuer_name)) between 1 and 160)
);

revoke all on private.card_catalog_target_issuers from public, anon, authenticated;

insert into private.card_catalog_target_issuers (issuer_key, issuer_name, notes)
values
  ('american-express', 'American Express', 'Named in the current coverage scope.'),
  ('chase', 'Chase', 'Named in the current coverage scope.'),
  ('citi', 'Citi', 'Named in the current coverage scope.'),
  ('capital-one', 'Capital One', 'Named in the current coverage scope.'),
  ('bank-of-america', 'Bank of America', 'Named in the current coverage scope.'),
  ('wells-fargo', 'Wells Fargo', 'Named in scope; no catalog rows are installed yet.'),
  ('us-bank', 'U.S. Bank', 'Named in the current coverage scope.'),
  ('barclays-us', 'Barclays US', 'Named in scope; no catalog rows are installed yet.'),
  ('discover', 'Discover', 'Named in scope; no catalog rows are installed yet.')
on conflict (issuer_key) do update set
  issuer_name = excluded.issuer_name,
  in_scope = excluded.in_scope,
  notes = excluded.notes;

-- Replace the existing narrow view in-place and append columns only. The
-- original columns remain in their original order for existing clients.
create or replace view public.card_catalog_current
with (security_barrier = true)
as
select
  p.id as product_version_id, p.stable_key as product_stable_key,
  p.version as product_version, p.issuer, p.product_name, p.aliases, p.market_scope,
  p.annual_fee, p.annual_fee_currency, p.official_url as product_official_url,
  p.verified_on as product_verified_on, p.content_hash as product_content_hash,
  t.id as template_version_id, t.stable_key as template_stable_key,
  t.version as template_version, t.name as template_name, t.summary,
  t.payload, t.date_strategy, t.fixed_start, t.fixed_end, t.setup_field,
  t.terms_timezone, t.default_selected, t.confidence,
  t.official_url as template_official_url, t.verified_on as template_verified_on,
  t.content_hash as template_content_hash,
  greatest(current_date - p.verified_on, current_date - t.verified_on) as age_days,
  p.card_type, p.official_product_url, p.official_source_urls as product_source_urls,
  p.verification_state as product_verification_state,
  p.effective_from as product_effective_from, p.effective_to as product_effective_to,
  p.verification_notes as product_verification_notes,
  p.structured_content_hash as product_structured_content_hash,
  t.benefit_description, t.benefit_value, t.benefit_currency, t.benefit_unit,
  t.structured_recurrence_type, t.structured_recurrence_basis,
  t.reset_strategy, t.activation_required, t.eligibility, t.limits,
  t.merchant_scope, t.official_source_urls as benefit_source_urls,
  t.verification_state as benefit_verification_state,
  t.effective_from as benefit_effective_from, t.effective_to as benefit_effective_to,
  t.verification_notes as benefit_verification_notes,
  t.structured_content_hash as benefit_structured_content_hash,
  p.metadata as product_metadata,
  t.metadata as benefit_metadata
from private.card_catalog_product_versions p
join private.card_catalog_template_versions t on t.product_version_id = p.id
where p.is_current and p.status = 'current'
  and t.is_current and t.status = 'current'
  and p.effective_from <= current_date
  and (p.effective_to is null or p.effective_to >= current_date)
  and t.effective_from <= current_date
  and (t.effective_to is null or t.effective_to >= current_date);

revoke all on public.card_catalog_current from public, anon;
grant select on public.card_catalog_current to authenticated;

create or replace view public.card_catalog_coverage
with (security_barrier = true)
as
with products as (
  select issuer,
    count(*) as product_version_count,
    count(*) filter (where is_current and status = 'current') as current_product_count,
    count(*) filter (where is_current and status = 'current' and official_product_url is not null)
      as current_product_url_count,
    count(*) filter (where is_current and status = 'current'
      and verification_state = 'verified') as verified_product_count,
    count(*) filter (where is_current and status = 'current'
      and verification_state <> 'verified') as pending_product_count,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'stable_key', stable_key,
        'version', version,
        'product_name', product_name,
        'card_type', card_type,
        'official_url', official_url,
        'official_product_url', official_product_url,
        'official_source_urls', official_source_urls,
        'verification_state', verification_state,
        'verified_on', verified_on,
        'effective_from', effective_from,
        'effective_to', effective_to,
        'structured_content_hash', structured_content_hash,
        'metadata', metadata
      ) order by stable_key, version
    ) filter (where is_current and status = 'current'), '[]'::jsonb)
      as current_products
  from private.card_catalog_product_versions
  group by issuer
), templates as (
  select p.issuer,
    count(*) as template_version_count,
    count(*) filter (where t.is_current and t.status = 'current') as current_template_count,
    count(*) filter (where t.is_current and t.status = 'current'
      and t.benefit_value is not null
      and private.catalog_urls_valid(t.official_source_urls)) as structured_template_count,
    count(*) filter (where t.is_current and t.status = 'current'
      and t.verification_state = 'verified') as verified_template_count,
    count(*) filter (where t.is_current and t.status = 'current'
      and t.verification_state = 'pending') as pending_template_count,
    count(*) filter (where t.is_current and t.status = 'current'
      and t.verification_state = 'limited') as limited_template_count,
    count(*) filter (where t.is_current and t.status = 'current'
      and t.verification_state = 'contingent') as contingent_template_count
  from private.card_catalog_template_versions t
  join private.card_catalog_product_versions p on p.id = t.product_version_id
  group by p.issuer
)
select i.issuer_key, i.issuer_name, i.in_scope, i.notes,
  coalesce(p.product_version_count, 0)::bigint as product_version_count,
  coalesce(p.current_product_count, 0)::bigint as current_product_count,
  coalesce(p.current_product_url_count, 0)::bigint as current_product_url_count,
  coalesce(p.verified_product_count, 0)::bigint as verified_product_count,
  coalesce(p.pending_product_count, 0)::bigint as pending_product_count,
  coalesce(t.template_version_count, 0)::bigint as template_version_count,
  coalesce(t.current_template_count, 0)::bigint as current_template_count,
  coalesce(t.structured_template_count, 0)::bigint as structured_template_count,
  coalesce(t.verified_template_count, 0)::bigint as verified_template_count,
  coalesce(t.pending_template_count, 0)::bigint as pending_template_count,
  coalesce(t.limited_template_count, 0)::bigint as limited_template_count,
  coalesce(t.contingent_template_count, 0)::bigint as contingent_template_count,
  case
    when coalesce(p.current_product_count, 0) = 0 then 'not_started'
    when coalesce(t.verified_template_count, 0) = 0 then 'pending_review'
    when coalesce(t.current_template_count, 0) > coalesce(t.verified_template_count, 0)
      then 'partial'
    else 'covered'
  end as coverage_state,
  'Counts installed catalog rows only; not a claim of complete issuer product-market coverage.'
    as coverage_basis,
  coalesce(p.current_products, '[]'::jsonb) as current_products
from private.card_catalog_target_issuers i
left join products p on p.issuer = i.issuer_name
left join templates t on t.issuer = i.issuer_name
where i.in_scope;

create or replace view public.card_catalog_quality
with (security_barrier = true)
as
select
  'product'::text as entity_type,
  p.id as entity_id,
  p.stable_key,
  p.issuer,
  p.product_name,
  null::text as benefit_name,
  p.version,
  p.status,
  p.is_current,
  p.verification_state,
  p.verified_on,
  p.effective_from,
  p.effective_to,
  cardinality(p.official_source_urls)::integer as source_count,
  (p.official_product_url is not null and private.catalog_urls_valid(p.official_source_urls))
    as structured_fields_complete,
  case when p.verification_state = 'verified'
    and p.official_product_url is not null
    then 'verified' else p.verification_state end as quality_state,
  array_remove(array[
    case when p.official_product_url is null then 'official_product_url_pending' end,
    case when p.verification_state <> 'verified' then 'issuer_recheck_required' end
  ], null)::text[] as issues
from private.card_catalog_product_versions p
where p.is_current
union all
select
  'benefit'::text,
  t.id,
  t.stable_key,
  p.issuer,
  p.product_name,
  t.name,
  t.version,
  t.status,
  t.is_current,
  t.verification_state,
  t.verified_on,
  t.effective_from,
  t.effective_to,
  cardinality(t.official_source_urls)::integer,
  (length(btrim(t.benefit_description)) > 0
    and t.benefit_value is not null
    and ((t.payload->>'value_kind' = 'money' and t.benefit_currency is not null)
      or (t.payload->>'value_kind' in ('points', 'membership', 'other')
        and t.benefit_unit is not null))
    and t.structured_recurrence_type is not null
    and t.structured_recurrence_basis is not null
    and private.catalog_urls_valid(t.official_source_urls)) as structured_fields_complete,
  case when t.verification_state = 'verified'
    and t.benefit_value is not null
    and private.catalog_urls_valid(t.official_source_urls)
    then 'verified' else t.verification_state end,
  array_remove(array[
    case when t.benefit_value is null then 'benefit_value_pending' end,
    case when t.verification_state <> 'verified' then 'issuer_recheck_required' end,
    case when cardinality(t.merchant_scope) = 0 then 'merchant_scope_not_enumerated' end
  ], null)::text[]
from private.card_catalog_template_versions t
join private.card_catalog_product_versions p on p.id = t.product_version_id
where t.is_current;

revoke all on public.card_catalog_coverage, public.card_catalog_quality from public, anon;
grant select on public.card_catalog_coverage, public.card_catalog_quality to authenticated;
