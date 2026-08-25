-- Versioned, read-only card catalog and atomic account + benefit provisioning.
-- Catalog facts were last reviewed against issuer sources on 2026-08-25.

create table private.card_catalog_product_versions (
  id uuid primary key,
  stable_key text not null,
  version integer not null check (version > 0),
  issuer text not null,
  product_name text not null,
  aliases text[] not null default '{}',
  market_scope text not null default 'US consumer',
  annual_fee numeric(14,2),
  annual_fee_currency text,
  status text not null check (status in ('current', 'retired')),
  official_url text not null check (official_url ~ '^https://'),
  verified_on date not null,
  content_hash text not null,
  is_current boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  unique (stable_key, version),
  check ((annual_fee is null and annual_fee_currency is null) or
    (annual_fee >= 0 and annual_fee_currency ~ '^[A-Z]{3}$')),
  check (not is_current or status = 'current')
);

create unique index card_catalog_one_current_product
  on private.card_catalog_product_versions(stable_key) where is_current;

create table private.card_catalog_template_versions (
  id uuid primary key,
  stable_key text not null,
  version integer not null check (version > 0),
  product_version_id uuid not null references private.card_catalog_product_versions(id),
  name text not null,
  summary text not null,
  payload jsonb not null,
  date_strategy text not null check (date_strategy in
    ('calendar', 'account_anniversary', 'fixed', 'qualification_cycle')),
  fixed_start date,
  fixed_end date,
  setup_field text check (setup_field in ('benefit_anniversary_date', 'first_qualifying_month')),
  terms_timezone text not null default 'America/New_York',
  default_selected boolean not null default true,
  confidence text not null check (confidence in ('high', 'limited', 'contingent')),
  status text not null check (status in ('current', 'retired')),
  official_url text not null check (official_url ~ '^https://'),
  verified_on date not null,
  content_hash text not null,
  is_current boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  unique (stable_key, version),
  check (jsonb_typeof(payload) = 'object'),
  check (date_strategy <> 'fixed' or (fixed_start is not null and fixed_end is not null)),
  check ((fixed_start is null) = (fixed_end is null)),
  check (fixed_end is null or fixed_end >= fixed_start),
  check (not is_current or status = 'current')
);

create unique index card_catalog_one_current_template
  on private.card_catalog_template_versions(stable_key) where is_current;

revoke all on private.card_catalog_product_versions,
  private.card_catalog_template_versions from public, anon, authenticated;

alter table public.accounts
  add column benefit_anniversary_date date,
  add column origin_product_version_id uuid references private.card_catalog_product_versions(id),
  add column origin_product_stable_key text,
  add column origin_product_version integer,
  add column origin_product_hash text;

alter table public.benefit_definitions
  add column origin_source text not null default 'manual'
    check (origin_source in ('manual', 'catalog', 'import')),
  add column origin_template_version_id uuid references private.card_catalog_template_versions(id),
  add column origin_template_stable_key text,
  add column origin_template_version integer,
  add column origin_template_hash text,
  add column origin_verified_on date,
  add column customized_at timestamptz,
  add column terms_timezone text not null default 'America/New_York',
  add column period_value_rules jsonb not null default '[]'::jsonb;

alter table public.benefit_definition_revisions
  add column origin_source text not null default 'manual'
    check (origin_source in ('manual', 'catalog', 'import')),
  add column origin_template_version_id uuid references private.card_catalog_template_versions(id),
  add column origin_template_stable_key text,
  add column origin_template_version integer,
  add column origin_template_hash text,
  add column origin_verified_on date,
  add column customized_at timestamptz,
  add column terms_timezone text not null default 'America/New_York',
  add column period_value_rules jsonb not null default '[]'::jsonb;

create or replace function private.assert_period_value_rules(
  p_rules jsonb,
  p_value_kind public.benefit_value_kind,
  p_recurrence_type public.benefit_recurrence_type,
  p_recurrence_basis public.benefit_recurrence_basis
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_rule jsonb;
  v_unknown text;
  v_months integer[] := '{}';
begin
  if p_rules is null or jsonb_typeof(p_rules) <> 'array' or jsonb_array_length(p_rules) > 12 then
    raise exception 'period_value_rules must be an array with at most 12 entries' using errcode = '22023';
  end if;
  if p_rules <> '[]'::jsonb and
     (p_value_kind <> 'money' or p_recurrence_type = 'one_time' or p_recurrence_basis <> 'calendar') then
    raise exception 'period_value_rules require a finite-money calendar recurrence' using errcode = '22023';
  end if;
  for v_rule in select value from jsonb_array_elements(p_rules) loop
    if jsonb_typeof(v_rule) <> 'object' then
      raise exception 'every period value rule must be an object' using errcode = '22023';
    end if;
    select key into v_unknown from jsonb_object_keys(v_rule) keys(key)
      where key not in ('calendar_month', 'available_quantity') limit 1;
    if v_unknown is not null or not (v_rule ? 'calendar_month') or not (v_rule ? 'available_quantity')
       or (select count(*) from jsonb_object_keys(v_rule)) <> 2 then
      raise exception 'period value rules only support calendar_month and available_quantity'
        using errcode = '22023';
    end if;
    if (v_rule->>'calendar_month')::integer not between 1 and 12
       or (v_rule->>'available_quantity')::numeric <= 0
       or scale((v_rule->>'available_quantity')::numeric) > 2 then
      raise exception 'invalid period value rule month or quantity' using errcode = '22023';
    end if;
    if (v_rule->>'calendar_month')::integer = any(v_months) then
      raise exception 'period value rule months must be unique' using errcode = '22023';
    end if;
    v_months := array_append(v_months, (v_rule->>'calendar_month')::integer);
  end loop;
end;
$$;

revoke all on function private.assert_period_value_rules(
  jsonb, public.benefit_value_kind, public.benefit_recurrence_type,
  public.benefit_recurrence_basis) from public, anon, authenticated;

create or replace function private.apply_catalog_definition_context()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb := nullif(current_setting('app.catalog_definition_context', true), '')::jsonb;
  v_import_backup jsonb := nullif(current_setting('app.import_catalog_backup', true), '')::jsonb;
  v_import_marker constant text := '__perkledger_import_source__:';
  v_source_id text;
  v_profile_timezone text;
  v_business_changed boolean;
begin
  if tg_op = 'INSERT' then
    select p.timezone into v_profile_timezone from public.profiles p where p.user_id = new.user_id;
    new.terms_timezone := coalesce(nullif(v_context->>'terms_timezone', ''), v_profile_timezone,
      'America/New_York');
    new.period_value_rules := coalesce(v_context->'period_value_rules', '[]'::jsonb);
    new.origin_source := coalesce(nullif(v_context->>'origin_source', ''), 'manual');
    new.origin_template_version_id := nullif(v_context->>'origin_template_version_id', '')::uuid;
    new.origin_template_stable_key := nullif(v_context->>'origin_template_stable_key', '');
    new.origin_template_version := nullif(v_context->>'origin_template_version', '')::integer;
    new.origin_template_hash := nullif(v_context->>'origin_template_hash', '');
    new.origin_verified_on := nullif(v_context->>'origin_verified_on', '')::date;
    new.customized_at := nullif(v_context->>'customized_at', '')::timestamptz;
    if v_context is null and v_import_backup is not null then
      select substring(tag from length(v_import_marker) + 1) into v_source_id
      from unnest(new.tags) tag
      where tag like v_import_marker || '%'
      limit 1;
      if v_source_id is null then
        raise exception 'v2 benefit import is missing its source identity marker'
          using errcode = '22023';
      end if;
      new.tags := array(
        select tag from unnest(new.tags) tag where tag not like v_import_marker || '%'
      );
      select item into v_context
      from jsonb_array_elements(coalesce(v_import_backup->'definitions', '[]'::jsonb)) item
      where item->>'id' = v_source_id;
      if v_context is not null and exists (
        select 1 from private.card_catalog_template_versions t
        where t.id = nullif(v_context->>'origin_template_version_id', '')::uuid
          and t.stable_key = v_context->>'origin_template_stable_key'
          and t.version = nullif(v_context->>'origin_template_version', '')::integer
          and t.content_hash = v_context->>'origin_template_hash'
      ) and not exists (
        select 1
        from jsonb_array_elements(coalesce(v_import_backup->'revisions', '[]'::jsonb)) revision
        where revision->>'definition_id' = v_source_id
          and nullif(revision->>'revision_no', '')::integer =
            nullif(v_context->>'current_revision_no', '')::integer
          and (
            revision->>'origin_template_version_id' is distinct from
              v_context->>'origin_template_version_id'
            or revision->>'origin_template_stable_key' is distinct from
              v_context->>'origin_template_stable_key'
            or revision->>'origin_template_version' is distinct from
              v_context->>'origin_template_version'
            or revision->>'origin_template_hash' is distinct from
              v_context->>'origin_template_hash'
            or not exists (
              select 1 from private.card_catalog_template_versions t
              where t.id = nullif(revision->>'origin_template_version_id', '')::uuid
                and t.stable_key = revision->>'origin_template_stable_key'
                and t.version = nullif(revision->>'origin_template_version', '')::integer
                and t.content_hash = revision->>'origin_template_hash'
            )
          )
      ) then
        new.origin_source := 'catalog';
        new.origin_template_version_id := (v_context->>'origin_template_version_id')::uuid;
        new.origin_template_stable_key := v_context->>'origin_template_stable_key';
        new.origin_template_version := (v_context->>'origin_template_version')::integer;
        new.origin_template_hash := v_context->>'origin_template_hash';
        new.origin_verified_on := nullif(v_context->>'origin_verified_on', '')::date;
        new.customized_at := nullif(v_context->>'customized_at', '')::timestamptz;
      end if;
      new.terms_timezone := coalesce(nullif(v_context->>'terms_timezone', ''), new.terms_timezone);
      new.period_value_rules := coalesce(v_context->'period_value_rules', new.period_value_rules);
    end if;
  else
    if new.origin_source is distinct from old.origin_source
       or new.origin_template_version_id is distinct from old.origin_template_version_id
       or new.origin_template_stable_key is distinct from old.origin_template_stable_key
       or new.origin_template_version is distinct from old.origin_template_version
       or new.origin_template_hash is distinct from old.origin_template_hash
       or new.origin_verified_on is distinct from old.origin_verified_on then
      raise exception 'benefit template provenance is immutable' using errcode = '42501';
    end if;
    if v_context is not null then
      new.terms_timezone := coalesce(nullif(v_context->>'terms_timezone', ''), old.terms_timezone);
      new.period_value_rules := coalesce(v_context->'period_value_rules', old.period_value_rules);
    end if;
    v_business_changed := (to_jsonb(new) - array['updated_at','customized_at','active','recurrence_enabled','enrolled_at'])
      is distinct from
      (to_jsonb(old) - array['updated_at','customized_at','active','recurrence_enabled','enrolled_at']);
    if old.origin_template_version_id is not null and v_business_changed then
      new.customized_at := coalesce(old.customized_at, statement_timestamp());
    end if;
  end if;
  perform private.assert_period_value_rules(new.period_value_rules, new.value_kind,
    new.recurrence_type, new.recurrence_basis);
  if not exists (
    select 1 from pg_catalog.pg_timezone_names zone where zone.name = new.terms_timezone
  ) then
    raise exception 'terms_timezone must be an IANA timezone' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function private.apply_catalog_definition_context() from public, anon, authenticated;
create trigger apply_catalog_definition_context
before insert or update on public.benefit_definitions
for each row execute function private.apply_catalog_definition_context();

create or replace function private.apply_catalog_revision_context()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_import_backup jsonb := nullif(current_setting('app.import_catalog_backup', true), '')::jsonb;
  v_import_marker constant text := '__perkledger_import_source__:';
  v_source_id text;
  v_definition_origin_source text;
  v_definition_template_id uuid;
  v_definition_template_key text;
  v_definition_template_version integer;
  v_definition_template_hash text;
  v_current_revision_no integer;
begin
  select d.origin_source, d.origin_template_version_id, d.origin_template_stable_key,
    d.origin_template_version, d.origin_template_hash, d.origin_verified_on,
    d.customized_at, d.terms_timezone, d.period_value_rules
  into new.origin_source, new.origin_template_version_id, new.origin_template_stable_key,
    new.origin_template_version, new.origin_template_hash, new.origin_verified_on,
    new.customized_at, new.terms_timezone, new.period_value_rules
  from public.benefit_definitions d
  where d.id = new.definition_id and d.user_id = new.user_id;
  v_definition_origin_source := new.origin_source;
  v_definition_template_id := new.origin_template_version_id;
  v_definition_template_key := new.origin_template_stable_key;
  v_definition_template_version := new.origin_template_version;
  v_definition_template_hash := new.origin_template_hash;
  select d.current_revision_no into v_current_revision_no
  from public.benefit_definitions d where d.id = new.definition_id and d.user_id = new.user_id;
  if v_import_backup is not null then
    select substring(tag from length(v_import_marker) + 1) into v_source_id
    from unnest(new.tags) tag
    where tag like v_import_marker || '%'
    limit 1;
    if v_source_id is null then
      raise exception 'v2 revision import is missing its source identity marker'
        using errcode = '22023';
    end if;
    new.tags := array(
      select tag from unnest(new.tags) tag where tag not like v_import_marker || '%'
    );
    select item into v_item
    from jsonb_array_elements(coalesce(v_import_backup->'revisions', '[]'::jsonb)) item
    where item->>'id' = v_source_id;
    if v_item is not null then
      new.origin_source := 'manual';
      new.origin_template_version_id := null;
      new.origin_template_stable_key := null;
      new.origin_template_version := null;
      new.origin_template_hash := null;
      new.origin_verified_on := null;
      new.customized_at := nullif(v_item->>'customized_at', '')::timestamptz;
      if exists (
        select 1 from private.card_catalog_template_versions t
        where t.id = nullif(v_item->>'origin_template_version_id', '')::uuid
          and t.stable_key = v_item->>'origin_template_stable_key'
          and t.version = nullif(v_item->>'origin_template_version', '')::integer
          and t.content_hash = v_item->>'origin_template_hash'
      ) and (
        new.revision_no is distinct from v_current_revision_no
        or (
          v_definition_origin_source = 'catalog'
          and v_definition_template_id = nullif(v_item->>'origin_template_version_id', '')::uuid
          and v_definition_template_key = v_item->>'origin_template_stable_key'
          and v_definition_template_version = nullif(v_item->>'origin_template_version', '')::integer
          and v_definition_template_hash = v_item->>'origin_template_hash'
        )
      ) then
        new.origin_source := 'catalog';
        new.origin_template_version_id := (v_item->>'origin_template_version_id')::uuid;
        new.origin_template_stable_key := v_item->>'origin_template_stable_key';
        new.origin_template_version := (v_item->>'origin_template_version')::integer;
        new.origin_template_hash := v_item->>'origin_template_hash';
        new.origin_verified_on := nullif(v_item->>'origin_verified_on', '')::date;
      end if;
      new.terms_timezone := coalesce(nullif(v_item->>'terms_timezone', ''), new.terms_timezone);
      new.period_value_rules := coalesce(v_item->'period_value_rules', new.period_value_rules);
    end if;
  end if;
  perform private.assert_period_value_rules(new.period_value_rules, new.value_kind,
    new.recurrence_type, new.recurrence_basis);
  return new;
end;
$$;

revoke all on function private.apply_catalog_revision_context() from public, anon, authenticated;
create trigger apply_catalog_revision_context
before insert on public.benefit_definition_revisions
for each row execute function private.apply_catalog_revision_context();

create or replace function private.protect_account_catalog_origin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.origin_product_version_id is distinct from old.origin_product_version_id
     or new.origin_product_stable_key is distinct from old.origin_product_stable_key
     or new.origin_product_version is distinct from old.origin_product_version
     or new.origin_product_hash is distinct from old.origin_product_hash then
    raise exception 'account catalog provenance is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.protect_account_catalog_origin() from public, anon, authenticated;
create trigger protect_account_catalog_origin before update on public.accounts
for each row execute function private.protect_account_catalog_origin();

create or replace function private.apply_import_account_catalog_origin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_import_backup jsonb := nullif(current_setting('app.import_catalog_backup', true), '')::jsonb;
  v_import_marker constant text := '__perkledger_import_source__:';
  v_source_id text;
begin
  if v_import_backup is null then return new; end if;
  if new.notes not like v_import_marker || '%' then
    raise exception 'v2 account import is missing its source identity marker' using errcode = '22023';
  end if;
  v_source_id := substring(new.notes from length(v_import_marker) + 1);
  select item into v_item
  from jsonb_array_elements(coalesce(v_import_backup->'accounts', '[]'::jsonb)) item
  where item->>'id' = v_source_id;
  if v_item is null then
    raise exception 'v2 account source identity was not found' using errcode = '22023';
  end if;
  new.notes := nullif(v_item->>'notes', '');
  if v_item is not null and exists (
    select 1 from private.card_catalog_product_versions p
    where p.id = nullif(v_item->>'origin_product_version_id', '')::uuid
      and p.stable_key = v_item->>'origin_product_stable_key'
      and p.version = nullif(v_item->>'origin_product_version', '')::integer
      and p.content_hash = v_item->>'origin_product_hash'
  ) then
    new.origin_product_version_id := (v_item->>'origin_product_version_id')::uuid;
    new.origin_product_stable_key := v_item->>'origin_product_stable_key';
    new.origin_product_version := (v_item->>'origin_product_version')::integer;
    new.origin_product_hash := v_item->>'origin_product_hash';
  end if;
  new.benefit_anniversary_date := nullif(v_item->>'benefit_anniversary_date', '')::date;
  return new;
end;
$$;

revoke all on function private.apply_import_account_catalog_origin() from public, anon, authenticated;
create trigger apply_import_account_catalog_origin before insert on public.accounts
for each row execute function private.apply_import_account_catalog_origin();

-- Keep direct account editing available while making anniversary a distinct field.
grant insert (benefit_anniversary_date) on public.accounts to authenticated;
grant update (benefit_anniversary_date) on public.accounts to authenticated;

insert into private.card_catalog_product_versions
  (id, stable_key, version, issuer, product_name, aliases, annual_fee,
   annual_fee_currency, status, official_url, verified_on, content_hash, is_current)
values
  ('10000000-0000-4000-8000-000000000001', 'amex-platinum-us-consumer', 1,
   'American Express', 'Platinum Card', array['Amex Platinum'], 895, 'USD', 'current',
   'https://global.americanexpress.com/card-benefits/view-all/platinum', '2026-08-25',
   'amex-platinum-v1-20260825', true),
  ('10000000-0000-4000-8000-000000000002', 'amex-gold-us-consumer', 1,
   'American Express', 'Gold Card', array['Amex Gold'], 325, 'USD', 'current',
   'https://global.americanexpress.com/card-benefits/view-all/gold', '2026-08-25',
   'amex-gold-v1-20260825', true),
  ('10000000-0000-4000-8000-000000000003', 'amex-blue-cash-preferred', 1,
   'American Express', 'Blue Cash Preferred', array['BCP'], 95, 'USD', 'current',
   'https://www.americanexpress.com/us/credit-cards/card/blue-cash-preferred/', '2026-08-25',
   'amex-bcp-v1-20260825', true),
  ('10000000-0000-4000-8000-000000000004', 'chase-sapphire-reserve', 1,
   'Chase', 'Sapphire Reserve', array['CSR'], 795, 'USD', 'current',
   'https://creditcards.chase.com/rewards-credit-cards/sapphire/reserve', '2026-08-25',
   'chase-csr-v1-20260825', true),
  ('10000000-0000-4000-8000-000000000005', 'chase-sapphire-preferred', 1,
   'Chase', 'Sapphire Preferred', array['CSP'], 95, 'USD', 'current',
   'https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred', '2026-08-25',
   'chase-csp-v1-20260825', true),
  ('10000000-0000-4000-8000-000000000006', 'capital-one-venture-x', 1,
   'Capital One', 'Venture X', array['Venture X Rewards'], 395, 'USD', 'current',
   'https://www.capitalone.com/credit-cards/venture-x/', '2026-08-25',
   'capital-one-vx-v1-20260825', true),
  ('10000000-0000-4000-8000-000000000007', 'us-bank-altitude-go', 1,
   'U.S. Bank', 'Altitude Go', array['Altitude Go Visa Signature'], 0, 'USD', 'current',
   'https://www.usbank.com/credit-cards/altitude-go-visa-signature-credit-card.html', '2026-08-25',
   'usbank-go-v1-20260825', true),
  ('10000000-0000-4000-8000-000000000008', 'us-bank-shield', 1,
   'U.S. Bank', 'Shield', array['Shield Visa'], 0, 'USD', 'current',
   'https://www.usbank.com/credit-cards/shield-visa-credit-card.html', '2026-08-25',
   'usbank-shield-v1-20260825', true),
  ('10000000-0000-4000-8000-000000000009', 'bofa-premium-rewards', 1,
   'Bank of America', 'Premium Rewards', array['BoA Premium Rewards'], 95, 'USD', 'current',
   'https://www.bankofamerica.com/credit-cards/products/premium-rewards-credit-card/', '2026-08-25',
   'bofa-pr-v1-20260825', true),
  ('10000000-0000-4000-8000-00000000000a', 'bofa-premium-rewards-elite', 1,
   'Bank of America', 'Premium Rewards Elite', array['BoA Premium Rewards Elite'], 550, 'USD', 'current',
   'https://www.bankofamerica.com/credit-cards/products/premium-rewards-elite-credit-card/', '2026-08-25',
   'bofa-pre-v1-20260825', true),
  ('10000000-0000-4000-8000-00000000000b', 'citi-strata-elite', 1,
   'Citi', 'Strata Elite', array['Citi Strata Elite'], 595, 'USD', 'current',
   'https://www.citi.com/credit-cards/citi-strata-elite-credit-card', '2026-08-25',
   'citi-elite-v1-20260825', true),
  ('10000000-0000-4000-8000-00000000000c', 'citi-strata-premier', 1,
   'Citi', 'Strata Premier', array['Citi Premier'], 95, 'USD', 'current',
   'https://www.citi.com/credit-cards/citi-strata-premier-credit-card', '2026-08-25',
   'citi-premier-v1-20260825', true);

-- Each payload is an ordinary benefit payload minus dates/account. The bundle RPC
-- derives dates from the immutable strategy and records the exact version/hash.
insert into private.card_catalog_template_versions
  (id, stable_key, version, product_version_id, name, summary, payload, date_strategy,
   fixed_start, fixed_end, setup_field, terms_timezone, default_selected, confidence,
   status, official_url, verified_on, content_hash, is_current)
select x.id::uuid, x.stable_key, 1, x.product_id::uuid, x.name, x.summary,
  x.payload, x.date_strategy, x.fixed_start, x.fixed_end, x.setup_field,
  coalesce(x.terms_timezone, 'America/New_York'), x.default_selected, x.confidence,
  'current', x.url, '2026-08-25', x.stable_key || '-v1-20260825', true
from jsonb_to_recordset($catalog$
[
 {"id":"20000000-0000-4000-8000-000000000001","stable_key":"amex-platinum-uber-cash","product_id":"10000000-0000-4000-8000-000000000001","name":"Uber Cash","summary":"$15 monthly; $35 in December.","payload":{"name":"Uber Cash","category":"Transportation","description":"Monthly Uber Cash benefit.","notes":"December availability is $35; other months are $15.","value_kind":"money","benefit_amount":15,"currency":"USD","merchant":"Uber","tags":["rideshare"],"eligibility_notes":"Issuer terms and enrollment/account-linking requirements control eligibility.","recurrence_type":"monthly","recurrence_basis":"calendar","period_value_rules":[{"calendar_month":12,"available_quantity":35}],"expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://global.americanexpress.com/card-benefits/view-all/platinum"},
 {"id":"20000000-0000-4000-8000-000000000002","stable_key":"amex-platinum-digital-entertainment","product_id":"10000000-0000-4000-8000-000000000001","name":"Digital Entertainment Credit","summary":"$25 monthly; enrollment required.","payload":{"name":"Digital Entertainment Credit","category":"Entertainment","description":"Monthly digital entertainment statement credit.","value_kind":"money","benefit_amount":25,"currency":"USD","tags":["entertainment","enrollment"],"eligibility_notes":"Enrollment and eligible service terms apply.","enrollment_required":true,"recurrence_type":"monthly","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://global.americanexpress.com/card-benefits/view-all/platinum"},
 {"id":"20000000-0000-4000-8000-000000000003","stable_key":"amex-platinum-resy","product_id":"10000000-0000-4000-8000-000000000001","name":"Resy Credit","summary":"$100 quarterly; enrollment required.","payload":{"name":"Resy Credit","category":"Dining","value_kind":"money","benefit_amount":100,"currency":"USD","merchant":"Resy","tags":["dining","enrollment"],"eligibility_notes":"Enrollment and eligible U.S. Resy purchase terms apply.","enrollment_required":true,"recurrence_type":"quarterly","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://global.americanexpress.com/card-benefits/view-all/platinum"},
 {"id":"20000000-0000-4000-8000-000000000004","stable_key":"amex-platinum-hotel","product_id":"10000000-0000-4000-8000-000000000001","name":"Hotel Credit","summary":"$300 semiannually.","payload":{"name":"Hotel Credit","category":"Hotel","value_kind":"money","benefit_amount":300,"currency":"USD","tags":["hotel","travel"],"eligibility_notes":"Eligible prepaid hotel bookings and issuer terms apply.","recurrence_type":"semiannual","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://global.americanexpress.com/card-benefits/view-all/platinum"},
 {"id":"20000000-0000-4000-8000-000000000005","stable_key":"amex-platinum-airline-fee","product_id":"10000000-0000-4000-8000-000000000001","name":"Airline Fee Credit","summary":"$200 per calendar year; airline selection required.","payload":{"name":"Airline Fee Credit","category":"Airline","value_kind":"money","benefit_amount":200,"currency":"USD","tags":["airline","enrollment"],"eligibility_notes":"Select one qualifying airline and confirm eligible incidental fee terms.","enrollment_required":true,"recurrence_type":"annual","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://global.americanexpress.com/card-benefits/view-all/platinum"},
 {"id":"20000000-0000-4000-8000-000000000006","stable_key":"amex-platinum-clear","product_id":"10000000-0000-4000-8000-000000000001","name":"CLEAR+ Credit","summary":"$219 per calendar year.","payload":{"name":"CLEAR+ Credit","category":"Travel","value_kind":"money","benefit_amount":219,"currency":"USD","merchant":"CLEAR","eligibility_notes":"Eligible CLEAR+ membership charges and issuer terms apply.","recurrence_type":"annual","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://global.americanexpress.com/card-benefits/view-all/platinum"},
 {"id":"20000000-0000-4000-8000-000000000007","stable_key":"amex-platinum-lululemon","product_id":"10000000-0000-4000-8000-000000000001","name":"lululemon Credit","summary":"$75 quarterly; enrollment required.","payload":{"name":"lululemon Credit","category":"Shopping portal","value_kind":"money","benefit_amount":75,"currency":"USD","merchant":"lululemon","enrollment_required":true,"eligibility_notes":"Enrollment and eligible U.S. purchase terms apply.","recurrence_type":"quarterly","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://global.americanexpress.com/card-benefits/view-all/platinum"},
 {"id":"20000000-0000-4000-8000-000000000008","stable_key":"amex-platinum-equinox","product_id":"10000000-0000-4000-8000-000000000001","name":"Equinox Credit","summary":"$300 per calendar year; enrollment required.","payload":{"name":"Equinox Credit","category":"Membership","value_kind":"money","benefit_amount":300,"currency":"USD","merchant":"Equinox","enrollment_required":true,"eligibility_notes":"Enrollment and eligible membership terms apply.","recurrence_type":"annual","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://global.americanexpress.com/card-benefits/view-all/platinum"},
 {"id":"20000000-0000-4000-8000-000000000009","stable_key":"amex-platinum-uber-one","product_id":"10000000-0000-4000-8000-000000000001","name":"Uber One Credit","summary":"$120 per calendar year.","payload":{"name":"Uber One Credit","category":"Membership","value_kind":"money","benefit_amount":120,"currency":"USD","merchant":"Uber","eligibility_notes":"Eligible auto-renewing Uber One membership terms apply.","recurrence_type":"annual","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://global.americanexpress.com/card-benefits/view-all/platinum"},
 {"id":"20000000-0000-4000-8000-00000000000a","stable_key":"amex-platinum-oura","product_id":"10000000-0000-4000-8000-000000000001","name":"Oura Ring Credit","summary":"$200 per calendar year; enrollment required.","payload":{"name":"Oura Ring Credit","category":"Shopping portal","value_kind":"money","benefit_amount":200,"currency":"USD","merchant":"Oura","enrollment_required":true,"eligibility_notes":"Enrollment and eligible Oura purchase terms apply.","recurrence_type":"annual","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://global.americanexpress.com/card-benefits/detail/oura-credit/platinum"},
 {"id":"20000000-0000-4000-8000-00000000000b","stable_key":"amex-platinum-walmart-plus","product_id":"10000000-0000-4000-8000-000000000001","name":"Walmart+ Membership Credit","summary":"One membership credit monthly, currently up to $12.95 plus tax.","payload":{"name":"Walmart+ Membership Credit","category":"Membership","description":"Monthly Walmart+ membership reimbursement marker.","notes":"Issuer currently describes reimbursement up to $12.95 plus applicable taxes; tracked as one membership credit.","value_kind":"membership","benefit_amount":1,"unit_label":"membership credit","merchant":"Walmart+","eligibility_notes":"Eligible monthly membership and issuer terms apply.","recurrence_type":"monthly","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://global.americanexpress.com/card-benefits/view-all/platinum"},
 {"id":"20000000-0000-4000-8000-00000000000c","stable_key":"amex-gold-uber","product_id":"10000000-0000-4000-8000-000000000002","name":"Uber Cash","summary":"$10 monthly.","payload":{"name":"Uber Cash","category":"Transportation","value_kind":"money","benefit_amount":10,"currency":"USD","merchant":"Uber","eligibility_notes":"Account linking and issuer terms apply.","recurrence_type":"monthly","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://global.americanexpress.com/card-benefits/view-all/gold"},
 {"id":"20000000-0000-4000-8000-00000000000d","stable_key":"amex-gold-dining","product_id":"10000000-0000-4000-8000-000000000002","name":"Dining Credit","summary":"$10 monthly; enrollment required.","payload":{"name":"Dining Credit","category":"Dining","value_kind":"money","benefit_amount":10,"currency":"USD","enrollment_required":true,"eligibility_notes":"Enrollment and eligible partner terms apply.","recurrence_type":"monthly","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://global.americanexpress.com/card-benefits/view-all/gold"},
 {"id":"20000000-0000-4000-8000-00000000000e","stable_key":"amex-gold-dunkin","product_id":"10000000-0000-4000-8000-000000000002","name":"Dunkin' Credit","summary":"$7 monthly; enrollment required.","payload":{"name":"Dunkin' Credit","category":"Dining","value_kind":"money","benefit_amount":7,"currency":"USD","merchant":"Dunkin'","enrollment_required":true,"eligibility_notes":"Enrollment and eligible U.S. Dunkin' purchase terms apply.","recurrence_type":"monthly","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://global.americanexpress.com/card-benefits/view-all/gold"},
 {"id":"20000000-0000-4000-8000-00000000000f","stable_key":"amex-gold-resy","product_id":"10000000-0000-4000-8000-000000000002","name":"Resy Credit","summary":"$50 semiannually; enrollment required.","payload":{"name":"Resy Credit","category":"Dining","value_kind":"money","benefit_amount":50,"currency":"USD","merchant":"Resy","enrollment_required":true,"eligibility_notes":"Enrollment and eligible U.S. Resy purchase terms apply.","recurrence_type":"semiannual","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://global.americanexpress.com/card-benefits/view-all/gold"},
 {"id":"20000000-0000-4000-8000-000000000010","stable_key":"amex-bcp-disney-streaming","product_id":"10000000-0000-4000-8000-000000000003","name":"Disney Streaming Credit","summary":"$10 monthly; enrollment required.","payload":{"name":"Disney Streaming Credit","category":"Subscription","value_kind":"money","benefit_amount":10,"currency":"USD","enrollment_required":true,"eligibility_notes":"Enrollment and eligible Disney streaming bundle terms apply.","recurrence_type":"monthly","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://www.americanexpress.com/us/credit-cards/card/blue-cash-preferred/"},
 {"id":"20000000-0000-4000-8000-000000000011","stable_key":"chase-csr-travel","product_id":"10000000-0000-4000-8000-000000000004","name":"Annual Travel Credit","summary":"$300 each account benefit year; boundary is an estimate.","payload":{"name":"Annual Travel Credit","category":"Travel","value_kind":"money","benefit_amount":300,"currency":"USD","eligibility_notes":"Broad travel purchases may qualify. The benefit-anniversary boundary is an estimate; statement timing and issuer terms control.","recurrence_type":"annual","recurrence_basis":"anniversary","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"account_anniversary","setup_field":"benefit_anniversary_date","default_selected":true,"confidence":"high","url":"https://creditcards.chase.com/rewards-credit-cards/sapphire/reserve"},
 {"id":"20000000-0000-4000-8000-000000000012","stable_key":"chase-csr-edit","product_id":"10000000-0000-4000-8000-000000000004","name":"The Edit Credit","summary":"$250 semiannually.","payload":{"name":"The Edit Credit","category":"Hotel","value_kind":"money","benefit_amount":250,"currency":"USD","eligibility_notes":"Eligible prepaid The Edit bookings through Chase Travel; issuer terms apply.","recurrence_type":"semiannual","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://creditcards.chase.com/rewards-credit-cards/sapphire/reserve"},
 {"id":"20000000-0000-4000-8000-000000000013","stable_key":"chase-csr-exclusive-tables","product_id":"10000000-0000-4000-8000-000000000004","name":"Exclusive Tables Credit","summary":"$150 semiannually through June 30, 2030.","payload":{"name":"Exclusive Tables Credit","category":"Dining","value_kind":"money","benefit_amount":150,"currency":"USD","eligibility_notes":"Eligible Sapphire Reserve Exclusive Tables purchases; issuer terms apply.","recurrence_type":"semiannual","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","fixed_start":"2026-01-01","fixed_end":"2030-06-30","default_selected":true,"confidence":"high","url":"https://creditcards.chase.com/rewards-credit-cards/sapphire/reserve"},
 {"id":"20000000-0000-4000-8000-000000000014","stable_key":"chase-csr-doordash-restaurant","product_id":"10000000-0000-4000-8000-000000000004","name":"DoorDash Restaurant Credit","summary":"$5 monthly.","payload":{"name":"DoorDash Restaurant Credit","category":"Dining","value_kind":"money","benefit_amount":5,"currency":"USD","merchant":"DoorDash","eligibility_notes":"Eligible restaurant orders and activation terms apply.","recurrence_type":"monthly","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://creditcards.chase.com/rewards-credit-cards/sapphire/reserve"},
 {"id":"20000000-0000-4000-8000-000000000015","stable_key":"chase-csr-doordash-nonrestaurant-1","product_id":"10000000-0000-4000-8000-000000000004","name":"DoorDash Non-Restaurant Coupon 1","summary":"First independent $10 monthly coupon.","payload":{"name":"DoorDash Non-Restaurant Coupon 1","category":"Dining","value_kind":"money","benefit_amount":10,"currency":"USD","merchant":"DoorDash","eligibility_notes":"One of two separate monthly non-restaurant coupons; activation and eligible category terms apply.","recurrence_type":"monthly","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://creditcards.chase.com/rewards-credit-cards/sapphire/reserve"},
 {"id":"20000000-0000-4000-8000-000000000016","stable_key":"chase-csr-doordash-nonrestaurant-2","product_id":"10000000-0000-4000-8000-000000000004","name":"DoorDash Non-Restaurant Coupon 2","summary":"Second independent $10 monthly coupon.","payload":{"name":"DoorDash Non-Restaurant Coupon 2","category":"Dining","value_kind":"money","benefit_amount":10,"currency":"USD","merchant":"DoorDash","eligibility_notes":"One of two separate monthly non-restaurant coupons; activation and eligible category terms apply.","recurrence_type":"monthly","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://creditcards.chase.com/rewards-credit-cards/sapphire/reserve"},
 {"id":"20000000-0000-4000-8000-000000000017","stable_key":"chase-csr-stubhub","product_id":"10000000-0000-4000-8000-000000000004","name":"StubHub/viagogo Credit","summary":"$150 semiannually through December 31, 2027.","payload":{"name":"StubHub/viagogo Credit","category":"Entertainment","value_kind":"money","benefit_amount":150,"currency":"USD","merchant":"StubHub/viagogo","eligibility_notes":"Eligible direct purchases and issuer terms apply.","recurrence_type":"semiannual","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","fixed_start":"2026-01-01","fixed_end":"2027-12-31","default_selected":true,"confidence":"high","url":"https://creditcards.chase.com/rewards-credit-cards/sapphire/reserve"},
 {"id":"20000000-0000-4000-8000-000000000018","stable_key":"chase-csr-lyft","product_id":"10000000-0000-4000-8000-000000000004","name":"Lyft Credit","summary":"$10 monthly through September 30, 2027.","payload":{"name":"Lyft Credit","category":"Transportation","value_kind":"money","benefit_amount":10,"currency":"USD","merchant":"Lyft","eligibility_notes":"Eligible Lyft purchases and issuer terms apply.","recurrence_type":"monthly","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","fixed_start":"2026-01-01","fixed_end":"2027-09-30","default_selected":true,"confidence":"high","url":"https://creditcards.chase.com/rewards-credit-cards/sapphire/reserve"},
 {"id":"20000000-0000-4000-8000-000000000019","stable_key":"chase-csr-peloton","product_id":"10000000-0000-4000-8000-000000000004","name":"Peloton Credit","summary":"$10 monthly through December 31, 2027.","payload":{"name":"Peloton Credit","category":"Subscription","value_kind":"money","benefit_amount":10,"currency":"USD","merchant":"Peloton","eligibility_notes":"Eligible Peloton membership purchases and issuer terms apply.","recurrence_type":"monthly","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","fixed_start":"2026-01-01","fixed_end":"2027-12-31","default_selected":true,"confidence":"high","url":"https://creditcards.chase.com/rewards-credit-cards/sapphire/reserve"},
 {"id":"20000000-0000-4000-8000-00000000001a","stable_key":"chase-csr-select-hotels-2026","product_id":"10000000-0000-4000-8000-000000000004","name":"Select Chase Travel Hotel Credit","summary":"$250 one-time offer for 2026; review eligibility.","payload":{"name":"Select Chase Travel Hotel Credit","category":"Hotel","value_kind":"money","benefit_amount":250,"currency":"USD","eligibility_notes":"Confirm your account is eligible and review the select-hotel booking terms before relying on this offer.","recurrence_type":"one_time","recurrence_basis":"none","expiration_reminder_enabled":true,"reactivation_reminder_enabled":false},"date_strategy":"fixed","fixed_start":"2026-01-01","fixed_end":"2026-12-31","default_selected":false,"confidence":"limited","url":"https://creditcards.chase.com/a1/sapphire-offer-details"},
 {"id":"20000000-0000-4000-8000-00000000001b","stable_key":"chase-csr-ihg-platinum","product_id":"10000000-0000-4000-8000-000000000004","name":"IHG Platinum Status","summary":"One membership through December 31, 2027; activation may apply.","payload":{"name":"IHG Platinum Status","category":"Membership","value_kind":"membership","benefit_amount":1,"unit_label":"membership","eligibility_notes":"Confirm activation, enrollment, and account eligibility terms.","recurrence_type":"one_time","recurrence_basis":"none","expiration_reminder_enabled":true,"reactivation_reminder_enabled":false},"date_strategy":"fixed","fixed_start":"2026-01-01","fixed_end":"2027-12-31","default_selected":false,"confidence":"limited","url":"https://creditcards.chase.com/a1/sapphire-offer-details"},
 {"id":"20000000-0000-4000-8000-00000000001c","stable_key":"chase-csp-hotel","product_id":"10000000-0000-4000-8000-000000000005","name":"Annual Hotel Credit","summary":"$100 each account benefit year; boundary is an estimate.","payload":{"name":"Annual Hotel Credit","category":"Hotel","value_kind":"money","benefit_amount":100,"currency":"USD","eligibility_notes":"Eligible hotel bookings through Chase Travel. Statement timing and issuer terms control the anniversary boundary.","recurrence_type":"annual","recurrence_basis":"anniversary","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"account_anniversary","setup_field":"benefit_anniversary_date","default_selected":true,"confidence":"high","url":"https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred"},
 {"id":"20000000-0000-4000-8000-00000000001d","stable_key":"capital-one-vx-travel","product_id":"10000000-0000-4000-8000-000000000006","name":"Capital One Travel Credit","summary":"$300 each account anniversary year.","payload":{"name":"Capital One Travel Credit","category":"Travel","value_kind":"money","benefit_amount":300,"currency":"USD","merchant":"Capital One Travel","eligibility_notes":"Eligible bookings through Capital One Travel and issuer terms apply.","recurrence_type":"annual","recurrence_basis":"anniversary","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"account_anniversary","setup_field":"benefit_anniversary_date","default_selected":true,"confidence":"high","url":"https://www.capitalone.com/credit-cards/venture-x/"},
 {"id":"20000000-0000-4000-8000-00000000001e","stable_key":"usbank-go-streaming","product_id":"10000000-0000-4000-8000-000000000007","name":"Expected Streaming Qualification Credit","summary":"Expected $15 after 11 consecutive qualifying months; confirm posting.","payload":{"name":"Expected Streaming Qualification Credit","category":"Subscription","description":"Contingent qualification-cycle marker, not a guaranteed available credit.","notes":"Confirm the issuer actually posts the credit before marking used.","value_kind":"money","benefit_amount":15,"currency":"USD","eligibility_notes":"Unverified qualification details may change. Maintain qualifying streaming purchases and confirm current issuer terms.","recurrence_type":"annual","recurrence_basis":"anniversary","expiration_reminder_enabled":false,"reactivation_reminder_enabled":false},"date_strategy":"qualification_cycle","setup_field":"first_qualifying_month","default_selected":false,"confidence":"contingent","url":"https://www.usbank.com/credit-cards/altitude-go-visa-signature-credit-card.html"},
 {"id":"20000000-0000-4000-8000-00000000001f","stable_key":"usbank-shield-streaming","product_id":"10000000-0000-4000-8000-000000000008","name":"Expected Streaming Qualification Credit","summary":"Expected $20 after 11 consecutive qualifying months; confirm posting.","payload":{"name":"Expected Streaming Qualification Credit","category":"Subscription","description":"Contingent qualification-cycle marker, not a guaranteed available credit.","notes":"Confirm the issuer actually posts the credit before marking used.","value_kind":"money","benefit_amount":20,"currency":"USD","eligibility_notes":"Unverified qualification details may change. Maintain qualifying streaming purchases and confirm current issuer terms.","recurrence_type":"annual","recurrence_basis":"anniversary","expiration_reminder_enabled":false,"reactivation_reminder_enabled":false},"date_strategy":"qualification_cycle","setup_field":"first_qualifying_month","default_selected":false,"confidence":"contingent","url":"https://www.usbank.com/credit-cards/shield-visa-credit-card.html"},
 {"id":"20000000-0000-4000-8000-000000000020","stable_key":"bofa-pr-airline","product_id":"10000000-0000-4000-8000-000000000009","name":"Airline Incidental Credit","summary":"$100 per calendar year.","payload":{"name":"Airline Incidental Credit","category":"Airline","value_kind":"money","benefit_amount":100,"currency":"USD","eligibility_notes":"Eligible airline incidental purchases and issuer terms apply.","recurrence_type":"annual","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://www.bankofamerica.com/credit-cards/products/premium-rewards-credit-card/"},
 {"id":"20000000-0000-4000-8000-000000000021","stable_key":"bofa-pre-airline","product_id":"10000000-0000-4000-8000-00000000000a","name":"Airline Incidental Credit","summary":"$300 per calendar year.","payload":{"name":"Airline Incidental Credit","category":"Airline","value_kind":"money","benefit_amount":300,"currency":"USD","eligibility_notes":"Eligible airline incidental purchases and issuer terms apply.","recurrence_type":"annual","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://www.bankofamerica.com/credit-cards/products/premium-rewards-elite-credit-card/"},
 {"id":"20000000-0000-4000-8000-000000000022","stable_key":"bofa-pre-lifestyle","product_id":"10000000-0000-4000-8000-00000000000a","name":"Lifestyle Credit","summary":"$150 per calendar year.","payload":{"name":"Lifestyle Credit","category":"Other","value_kind":"money","benefit_amount":150,"currency":"USD","eligibility_notes":"Eligible lifestyle categories and issuer terms apply.","recurrence_type":"annual","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://www.bankofamerica.com/credit-cards/products/premium-rewards-elite-credit-card/"},
 {"id":"20000000-0000-4000-8000-000000000023","stable_key":"citi-elite-hotel","product_id":"10000000-0000-4000-8000-00000000000b","name":"Annual Hotel Benefit","summary":"$300 annually.","payload":{"name":"Annual Hotel Benefit","category":"Hotel","value_kind":"money","benefit_amount":300,"currency":"USD","eligibility_notes":"Eligible hotel booking and minimum-stay terms may apply; verify issuer terms.","recurrence_type":"annual","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://www.citi.com/credit-cards/citi-strata-elite-credit-card"},
 {"id":"20000000-0000-4000-8000-000000000024","stable_key":"citi-elite-splurge","product_id":"10000000-0000-4000-8000-00000000000b","name":"Splurge Credit","summary":"$200 annually.","payload":{"name":"Splurge Credit","category":"Other","value_kind":"money","benefit_amount":200,"currency":"USD","eligibility_notes":"Selection/enrollment and eligible merchant terms apply.","enrollment_required":true,"recurrence_type":"annual","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://www.citi.com/credit-cards/citi-strata-elite-credit-card"},
 {"id":"20000000-0000-4000-8000-000000000025","stable_key":"citi-elite-blacklane","product_id":"10000000-0000-4000-8000-00000000000b","name":"Blacklane Credit","summary":"$100 semiannually.","payload":{"name":"Blacklane Credit","category":"Transportation","value_kind":"money","benefit_amount":100,"currency":"USD","merchant":"Blacklane","eligibility_notes":"Eligible Blacklane purchases and issuer terms apply.","recurrence_type":"semiannual","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://www.citi.com/credit-cards/citi-strata-elite-credit-card"},
 {"id":"20000000-0000-4000-8000-000000000026","stable_key":"citi-elite-admirals","product_id":"10000000-0000-4000-8000-00000000000b","name":"Admirals Club Passes","summary":"Four passes annually.","payload":{"name":"Admirals Club Passes","category":"Membership","value_kind":"membership","benefit_amount":4,"unit_label":"pass","eligibility_notes":"Pass issuance, access, and eligible traveler terms apply.","recurrence_type":"annual","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://www.citi.com/credit-cards/citi-strata-elite-credit-card"},
 {"id":"20000000-0000-4000-8000-000000000027","stable_key":"citi-premier-hotel","product_id":"10000000-0000-4000-8000-00000000000c","name":"Annual Hotel Benefit","summary":"$100 annually on an eligible $500+ stay.","payload":{"name":"Annual Hotel Benefit","category":"Hotel","value_kind":"money","benefit_amount":100,"currency":"USD","minimum_spend":500,"eligibility_notes":"Eligible $500+ hotel stay booked through Citi Travel; issuer terms apply.","recurrence_type":"annual","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://www.citi.com/credit-cards/citi-strata-premier-credit-card"}
]
$catalog$::jsonb) as x(
  id text, stable_key text, product_id text, name text, summary text, payload jsonb,
  date_strategy text, fixed_start date, fixed_end date, setup_field text,
  terms_timezone text, default_selected boolean, confidence text, url text
);

-- Saks is retained only as a retired audit version and therefore never appears
-- in the current view or can be provisioned.
insert into private.card_catalog_template_versions
  (id, stable_key, version, product_version_id, name, summary, payload, date_strategy,
   fixed_start, fixed_end, terms_timezone, default_selected, confidence, status,
   official_url, verified_on, content_hash, is_current)
values (
  '20000000-0000-4000-8000-000000000028', 'amex-platinum-saks-retired', 1,
  '10000000-0000-4000-8000-000000000001', 'Saks Credit',
  'Retired June 30, 2026; unavailable for new provisioning.',
  '{"name":"Saks Credit","category":"Shopping portal","value_kind":"money","benefit_amount":50,"currency":"USD","recurrence_type":"semiannual","recurrence_basis":"calendar"}',
  'fixed', '2026-01-01', '2026-06-30', 'America/New_York', false, 'high', 'retired',
  'https://global.americanexpress.com/card-benefits/view-all/platinum', '2026-08-25',
  'amex-platinum-saks-retired-v1', false
);

update private.card_catalog_product_versions p
set content_hash = encode(extensions.digest(
  concat_ws('|', p.stable_key, p.version::text, p.issuer, p.product_name,
    p.market_scope, coalesce(p.annual_fee::text, ''), coalesce(p.annual_fee_currency, ''),
    p.status, p.official_url, p.verified_on::text)::bytea,
  'sha256'), 'hex');

update private.card_catalog_template_versions t
set content_hash = encode(extensions.digest(
  concat_ws('|', t.stable_key, t.version::text, t.product_version_id::text, t.name,
    t.summary, t.payload::text, t.date_strategy, coalesce(t.fixed_start::text, ''),
    coalesce(t.fixed_end::text, ''), coalesce(t.setup_field, ''), t.terms_timezone,
    t.default_selected::text, t.confidence, t.status, t.official_url,
    t.verified_on::text)::bytea,
  'sha256'), 'hex');

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
  greatest(current_date - p.verified_on, current_date - t.verified_on) as age_days
from private.card_catalog_product_versions p
join private.card_catalog_template_versions t on t.product_version_id = p.id
where p.is_current and p.status = 'current' and t.is_current and t.status = 'current';

revoke all on public.card_catalog_current from public, anon;
grant select on public.card_catalog_current to authenticated;

-- Wrap the original lifecycle entry points so new catalog metadata is handled
-- without changing the semantics of existing manual benefits.
alter function public.create_benefit(jsonb, integer) rename to create_benefit_legacy;
revoke all on function public.create_benefit_legacy(jsonb, integer)
  from public, anon, authenticated;

create or replace function private.create_benefit_for_user(
  p_user_id uuid,
  p_benefit jsonb,
  p_backfill_months integer,
  p_context jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_rules jsonb := coalesce(p_context->'period_value_rules', p_benefit->'period_value_rules', '[]'::jsonb);
  v_terms_timezone text := coalesce(nullif(p_context->>'terms_timezone', ''),
    nullif(p_benefit->>'terms_timezone', ''));
begin
  if p_user_id is distinct from private.require_authenticated_user() then
    raise exception 'benefit owner does not match the authenticated user' using errcode = '42501';
  end if;
  perform set_config('app.catalog_definition_context',
    (coalesce(p_context, '{}'::jsonb) || jsonb_build_object(
      'period_value_rules', v_rules,
      'terms_timezone', v_terms_timezone
    ))::text, true);
  v_result := public.create_benefit_legacy(
    p_benefit - array['period_value_rules','terms_timezone'], p_backfill_months);
  perform set_config('app.catalog_definition_context', '', true);
  return v_result;
exception when others then
  perform set_config('app.catalog_definition_context', '', true);
  raise;
end;
$$;

revoke all on function private.create_benefit_for_user(uuid, jsonb, integer, jsonb)
  from public, anon, authenticated;

create or replace function public.create_benefit(
  p_benefit jsonb,
  p_backfill_months integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_authenticated_user();
begin
  if p_benefit ?| array['origin_source','origin_template_version_id',
      'origin_template_stable_key','origin_template_version','origin_template_hash',
      'origin_verified_on','customized_at'] then
    raise exception 'manual benefit creation cannot set catalog provenance' using errcode = '42501';
  end if;
  return private.create_benefit_for_user(v_user_id, p_benefit, p_backfill_months,
    jsonb_build_object('origin_source', 'manual'));
end;
$$;

revoke all on function public.create_benefit(jsonb, integer) from public, anon;
grant execute on function public.create_benefit(jsonb, integer) to authenticated;

alter function public.edit_benefit(uuid, jsonb, text, date) rename to edit_benefit_legacy;
revoke all on function public.edit_benefit_legacy(uuid, jsonb, text, date)
  from public, anon, authenticated;

create or replace function public.edit_benefit(
  p_definition_id uuid,
  p_changes jsonb,
  p_scope text default 'future_periods',
  p_effective_from date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_authenticated_user();
  v_definition public.benefit_definitions%rowtype;
  v_context jsonb := '{}'::jsonb;
  v_result jsonb;
  v_effective_boundary date := p_effective_from;
begin
  if p_changes ?| array['origin_source','origin_template_version_id',
      'origin_template_stable_key','origin_template_version','origin_template_hash',
      'origin_verified_on','customized_at'] then
    raise exception 'benefit provenance cannot be edited' using errcode = '42501';
  end if;
  select * into v_definition from public.benefit_definitions d
    where d.id = p_definition_id and d.user_id = v_user_id;
  if not found then raise exception 'benefit not found' using errcode = 'P0002'; end if;
  if v_effective_boundary is null and p_scope = 'future_periods' then
    select min(i.period_start) into v_effective_boundary
    from public.benefit_instances i
    where i.definition_id = v_definition.id and i.voided_at is null
      and i.period_start >
        (statement_timestamp() at time zone v_definition.terms_timezone)::date;
  elsif v_effective_boundary is null and p_scope = 'current_and_future' then
    select i.period_start into v_effective_boundary
    from public.benefit_instances i
    where i.definition_id = v_definition.id and i.voided_at is null
      and (statement_timestamp() at time zone v_definition.terms_timezone)::date
        between i.period_start and i.period_end
    order by i.period_start limit 1;
  end if;
  if p_scope = 'current_and_future'
     and p_changes ?| array['terms_timezone','period_value_rules']
     and exists (
       select 1 from public.benefit_instances i
       where i.definition_id = v_definition.id and i.voided_at is null
         and (statement_timestamp() at time zone v_definition.terms_timezone)::date
           between i.period_start and i.period_end
         and (exists (select 1 from public.redemptions rd where rd.benefit_instance_id = i.id)
           or exists (select 1 from public.notifications n
             where n.benefit_instance_id = i.id and n.first_attempt_at is not null))
     ) then
    raise exception 'current period has usage or a notification attempt; use future-only plus explicit override'
      using errcode = '55000';
  end if;
  if p_changes ? 'terms_timezone' then
    v_context := v_context || jsonb_build_object('terms_timezone', p_changes->>'terms_timezone');
  end if;
  if p_changes ? 'period_value_rules' then
    v_context := v_context || jsonb_build_object('period_value_rules', p_changes->'period_value_rules');
  end if;
  perform set_config('app.catalog_definition_context', v_context::text, true);
  v_result := public.edit_benefit_legacy(p_definition_id,
    p_changes - array['terms_timezone','period_value_rules'], p_scope, v_effective_boundary);
  perform set_config('app.catalog_definition_context', '', true);
  return v_result;
exception when others then
  perform set_config('app.catalog_definition_context', '', true);
  raise;
end;
$$;

revoke all on function public.edit_benefit(uuid, jsonb, text, date) from public, anon;
grant execute on function public.edit_benefit(uuid, jsonb, text, date) to authenticated;

alter function public.set_recurrence_enabled(uuid, boolean)
  rename to set_recurrence_enabled_profile_legacy;
revoke all on function public.set_recurrence_enabled_profile_legacy(uuid, boolean)
  from public, anon, authenticated;

create or replace function public.set_recurrence_enabled(
  p_definition_id uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_authenticated_user();
  v_definition public.benefit_definitions%rowtype;
  v_today date;
  v_voided integer := 0;
  v_generated integer := 0;
begin
  select * into v_definition from public.benefit_definitions d
  where d.id = p_definition_id and d.user_id = v_user_id for update;
  if not found then raise exception 'benefit not found' using errcode = 'P0002'; end if;
  v_today := (statement_timestamp() at time zone v_definition.terms_timezone)::date;
  if v_definition.recurrence_type = 'one_time' then
    raise exception 'one-time benefits cannot enable recurrence' using errcode = '22023';
  end if;
  if v_definition.recurrence_enabled = p_enabled then
    return jsonb_build_object('definition_id', v_definition.id,
      'recurrence_enabled', p_enabled, 'voided_instances', 0, 'generated_instances', 0);
  end if;

  update public.benefit_definitions d set recurrence_enabled = p_enabled
  where d.id = v_definition.id;
  if not p_enabled then
    with candidates as (
      select i.id from public.benefit_instances i
      where i.definition_id = v_definition.id and i.voided_at is null
        and i.period_start > v_today
        and not exists (
          select 1 from public.redemptions redemption where redemption.benefit_instance_id = i.id)
        and not exists (
          select 1 from public.notifications notification
          where notification.benefit_instance_id = i.id and notification.first_attempt_at is not null)
      for update
    ), voided as (
      update public.benefit_instances i
      set voided_at = statement_timestamp(), void_reason = 'Recurrence disabled'
      from candidates c where i.id = c.id returning i.id
    )
    select count(*) into v_voided from voided;
    update public.notifications n set state = 'skipped', next_attempt_at = null
    where n.first_attempt_at is null and exists (
      select 1 from public.benefit_instances i
      where i.id = n.benefit_instance_id and i.definition_id = v_definition.id
        and i.voided_at is not null);
  else
    v_generated := private.materialize_definition(
      v_definition.id, v_today + 1,
      greatest(v_today + 31,
        (v_today + make_interval(months => v_definition.interval_months))::date),
      're_enable', false, true);
  end if;
  return jsonb_build_object('definition_id', v_definition.id,
    'recurrence_enabled', p_enabled, 'voided_instances', v_voided,
    'generated_instances', v_generated);
end;
$$;

revoke all on function public.set_recurrence_enabled(uuid, boolean) from public, anon;
grant execute on function public.set_recurrence_enabled(uuid, boolean) to authenticated;

alter function public.delete_benefit_draft(uuid) rename to delete_benefit_draft_profile_legacy;
revoke all on function public.delete_benefit_draft_profile_legacy(uuid)
  from public, anon, authenticated;

create or replace function public.delete_benefit_draft(p_definition_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_authenticated_user();
  v_definition public.benefit_definitions%rowtype;
  v_today date;
begin
  select * into v_definition from public.benefit_definitions d
  where d.id = p_definition_id and d.user_id = v_user_id for update;
  if not found then return false; end if;
  v_today := (statement_timestamp() at time zone v_definition.terms_timezone)::date;
  if exists (
    select 1 from public.benefit_instances i
    where i.definition_id = v_definition.id and (
      exists (select 1 from public.redemptions r where r.benefit_instance_id = i.id)
      or exists (select 1 from public.notifications n where n.benefit_instance_id = i.id)
      or i.period_start <= v_today)
  ) then
    raise exception 'only an unreferenced future draft may be hard-deleted; deactivate instead'
      using errcode = '55000';
  end if;
  perform set_config('app.lifecycle_write', 'on', true);
  delete from public.benefit_definitions d where d.id = v_definition.id;
  return true;
end;
$$;

revoke all on function public.delete_benefit_draft(uuid) from public, anon;
grant execute on function public.delete_benefit_draft(uuid) to authenticated;

alter function private.materialize_definition(uuid, date, date, public.instance_source,
  boolean, boolean) rename to materialize_definition_legacy;
revoke all on function private.materialize_definition_legacy(uuid, date, date,
  public.instance_source, boolean, boolean) from public, anon, authenticated;

create or replace function private.materialize_definition(
  p_definition_id uuid,
  p_from_date date,
  p_through_date date,
  p_source public.instance_source,
  p_allow_reactivation boolean default true,
  p_require_nominal_start boolean default false
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  v_count := private.materialize_definition_legacy(p_definition_id, p_from_date,
    p_through_date, p_source, p_allow_reactivation, p_require_nominal_start);

  update public.benefit_instances i
  set available_quantity = coalesce(
        (select (rule->>'available_quantity')::numeric
         from jsonb_array_elements(r.period_value_rules) rule
         where (rule->>'calendar_month')::integer = extract(month from i.nominal_start)::integer),
        case when r.value_kind = 'percentage_cashback' then r.cashback_cap else r.benefit_amount end
      ),
      reactivation_eligible = i.reactivation_eligible or (
        p_allow_reactivation
        and p_source not in ('backfill', 'import', 're_enable')
        and i.generated_source = p_source
        and (
          (p_source = 'creation' and
            i.period_start > (statement_timestamp() at time zone r.terms_timezone)::date)
          or (p_source <> 'creation' and
            i.period_start >= (statement_timestamp() at time zone r.terms_timezone)::date)
        )
      )
  from public.benefit_definition_revisions r
  where i.definition_id = p_definition_id
    and i.revision_id = r.id
    and i.voided_at is null
    and i.nominal_end >= p_from_date
    and i.nominal_start <= p_through_date;
  return v_count;
end;
$$;

revoke all on function private.materialize_definition(uuid, date, date,
  public.instance_source, boolean, boolean) from public, anon, authenticated;

create or replace function private.expand_catalog_template(
  p_template private.card_catalog_template_versions,
  p_account_id uuid,
  p_anniversary date,
  p_setup jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_payload jsonb := p_template.payload;
  v_effective date;
  v_end date := p_template.fixed_end;
  v_first_month date;
  v_terms_today date := (statement_timestamp() at time zone p_template.terms_timezone)::date;
  v_unknown text;
begin
  if p_setup is null then p_setup := '{}'::jsonb; end if;
  if jsonb_typeof(p_setup) <> 'object' then
    raise exception 'template setup must be an object' using errcode = '22023';
  end if;
  select key into v_unknown from jsonb_object_keys(p_setup) keys(key)
    where key <> 'first_qualifying_month' limit 1;
  if v_unknown is not null or
     (p_template.date_strategy <> 'qualification_cycle' and p_setup <> '{}'::jsonb) then
    raise exception 'unsupported setup field for selected template' using errcode = '22023';
  end if;
  if p_template.date_strategy = 'account_anniversary' then
    if p_anniversary is null then
      raise exception 'benefit_anniversary_date is required for selected anniversary benefits'
        using errcode = '22023';
    end if;
    v_effective := p_anniversary;
    v_payload := v_payload || jsonb_build_object('anchor_date', p_anniversary);
  elsif p_template.date_strategy = 'qualification_cycle' then
    if coalesce(p_setup->>'first_qualifying_month', '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
      raise exception 'first_qualifying_month is required in YYYY-MM format'
        using errcode = '22023';
    end if;
    v_first_month := ((p_setup->>'first_qualifying_month') || '-01')::date;
    v_effective := (v_first_month + interval '11 months')::date;
    v_payload := v_payload || jsonb_build_object('anchor_date', v_effective);
  elsif p_template.date_strategy = 'fixed' then
    v_effective := p_template.fixed_start;
  else
    v_effective := coalesce(p_template.fixed_start, date_trunc('year', v_terms_today)::date);
  end if;
  if p_template.fixed_end is not null and p_template.date_strategy <> 'fixed' then
    v_end := p_template.fixed_end;
  end if;
  return v_payload || jsonb_build_object(
    'account_id', p_account_id,
    'effective_date', v_effective,
    'end_date', v_end,
    'recurrence_enabled', coalesce(v_payload->>'recurrence_type', 'one_time') <> 'one_time',
    'terms_timezone', p_template.terms_timezone,
    'period_value_rules', coalesce(v_payload->'period_value_rules', '[]'::jsonb)
  );
end;
$$;

revoke all on function private.expand_catalog_template(
  private.card_catalog_template_versions, uuid, date, jsonb)
  from public, anon, authenticated;

create or replace function public.create_account_with_templates(
  p_account jsonb,
  p_product_version_id uuid,
  p_template_selections jsonb default '[]'::jsonb,
  p_stale_catalog_acknowledged boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_authenticated_user();
  v_product private.card_catalog_product_versions%rowtype;
  v_account public.accounts%rowtype;
  v_selection jsonb;
  v_template private.card_catalog_template_versions%rowtype;
  v_payload jsonb;
  v_created jsonb;
  v_definition_ids uuid[] := '{}';
  v_template_ids uuid[] := '{}';
  v_age integer;
  v_unknown text;
begin
  if p_account is null or jsonb_typeof(p_account) <> 'object' then
    raise exception 'account payload must be an object' using errcode = '22023';
  end if;
  select key into v_unknown from jsonb_object_keys(p_account) keys(key)
   where key not in ('display_name','issuer','card_service_name','nickname','last_four',
     'annual_fee','annual_fee_currency','renewal_date','benefit_anniversary_date','notes','active')
   limit 1;
  if v_unknown is not null then
    raise exception 'unsupported account field: %', v_unknown using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_template_selections, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_template_selections, '[]'::jsonb)) > 50 then
    raise exception 'template selections must be an array with at most 50 entries'
      using errcode = '22023';
  end if;

  if p_product_version_id is not null then
    select * into v_product from private.card_catalog_product_versions p
      where p.id = p_product_version_id for share;
    if not found or not v_product.is_current or v_product.status <> 'current' then
      raise exception 'CATALOG_CHANGED: selected product version is no longer current'
        using errcode = 'P0001';
    end if;
    v_age := current_date - v_product.verified_on;
    if v_age > 180 and not p_stale_catalog_acknowledged then
      raise exception 'STALE_CATALOG_ACK_REQUIRED: catalog was verified more than 180 days ago'
        using errcode = 'P0001';
    end if;
  elsif jsonb_array_length(coalesce(p_template_selections, '[]'::jsonb)) > 0 then
    raise exception 'a catalog product is required when templates are selected' using errcode = '22023';
  end if;

  if nullif(btrim(p_account->>'display_name'), '') is null
     or nullif(btrim(p_account->>'issuer'), '') is null
     or nullif(btrim(p_account->>'card_service_name'), '') is null then
    raise exception 'display name, issuer, and card/service name are required' using errcode = '22023';
  end if;
  if nullif(p_account->>'annual_fee', '') is not null
     and scale((p_account->>'annual_fee')::numeric) > 2 then
    raise exception 'annual_fee accepts at most two fractional digits' using errcode = '22023';
  end if;

  insert into public.accounts (
    user_id, display_name, issuer, card_service_name, nickname, last_four,
    annual_fee, annual_fee_currency, renewal_date, benefit_anniversary_date,
    notes, active, origin_product_version_id, origin_product_stable_key,
    origin_product_version, origin_product_hash
  ) values (
    v_user_id, btrim(p_account->>'display_name'), btrim(p_account->>'issuer'),
    btrim(p_account->>'card_service_name'), nullif(btrim(p_account->>'nickname'), ''),
    nullif(p_account->>'last_four', ''), nullif(p_account->>'annual_fee', '')::numeric,
    nullif(upper(p_account->>'annual_fee_currency'), ''),
    nullif(p_account->>'renewal_date', '')::date,
    nullif(p_account->>'benefit_anniversary_date', '')::date,
    nullif(p_account->>'notes', ''), coalesce((p_account->>'active')::boolean, true),
    v_product.id, v_product.stable_key, v_product.version, v_product.content_hash
  ) returning * into v_account;

  for v_selection in select value from jsonb_array_elements(coalesce(p_template_selections, '[]'::jsonb)) loop
    if jsonb_typeof(v_selection) <> 'object'
       or nullif(v_selection->>'template_version_id', '') is null then
      raise exception 'each selection requires an exact template_version_id' using errcode = '22023';
    end if;
    select key into v_unknown from jsonb_object_keys(v_selection) keys(key)
      where key not in ('template_version_id', 'setup') limit 1;
    if v_unknown is not null then
      raise exception 'unsupported template selection field: %', v_unknown using errcode = '22023';
    end if;
    if (v_selection->>'template_version_id')::uuid = any(v_template_ids) then
      raise exception 'template selections must be unique' using errcode = '22023';
    end if;
    select * into v_template from private.card_catalog_template_versions t
      where t.id = (v_selection->>'template_version_id')::uuid for share;
    if not found or not v_template.is_current or v_template.status <> 'current'
       or v_template.product_version_id is distinct from v_product.id then
      raise exception 'CATALOG_CHANGED: selected template version is no longer current'
        using errcode = 'P0001';
    end if;
    v_age := greatest(v_age, current_date - v_template.verified_on);
    if v_age > 180 and not p_stale_catalog_acknowledged then
      raise exception 'STALE_CATALOG_ACK_REQUIRED: catalog was verified more than 180 days ago'
        using errcode = 'P0001';
    end if;
    v_payload := private.expand_catalog_template(v_template, v_account.id,
      v_account.benefit_anniversary_date, coalesce(v_selection->'setup', '{}'::jsonb));
    v_created := private.create_benefit_for_user(v_user_id, v_payload, 0,
      jsonb_build_object(
        'origin_source', 'catalog',
        'origin_template_version_id', v_template.id,
        'origin_template_stable_key', v_template.stable_key,
        'origin_template_version', v_template.version,
        'origin_template_hash', v_template.content_hash,
        'origin_verified_on', v_template.verified_on,
        'terms_timezone', v_template.terms_timezone,
        'period_value_rules', coalesce(v_template.payload->'period_value_rules', '[]'::jsonb)
      ));
    v_definition_ids := array_append(v_definition_ids, (v_created->>'definition_id')::uuid);
    v_template_ids := array_append(v_template_ids, v_template.id);
  end loop;

  return jsonb_build_object('account_id', v_account.id,
    'definition_ids', to_jsonb(v_definition_ids),
    'benefits_created', cardinality(v_definition_ids),
    'catalog_verified_on', v_product.verified_on);
end;
$$;

revoke all on function public.create_account_with_templates(jsonb, uuid, jsonb, boolean)
  from public, anon;
grant execute on function public.create_account_with_templates(jsonb, uuid, jsonb, boolean)
  to authenticated;

create or replace function private.make_catalog_revision_snapshot(
  p_origin_source text,
  p_origin_template_version_id uuid,
  p_origin_template_stable_key text,
  p_origin_template_version integer,
  p_origin_template_hash text,
  p_origin_verified_on date,
  p_customized_at timestamptz,
  p_terms_timezone text,
  p_period_value_rules jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'origin_source', p_origin_source,
    'origin_template_version_id', p_origin_template_version_id,
    'origin_template_stable_key', p_origin_template_stable_key,
    'origin_template_version', p_origin_template_version,
    'origin_template_hash', p_origin_template_hash,
    'origin_verified_on', p_origin_verified_on,
    'customized_at', p_customized_at,
    'terms_timezone', p_terms_timezone,
    'period_value_rules', coalesce(p_period_value_rules, '[]'::jsonb)
  ));
$$;

revoke all on function private.make_catalog_revision_snapshot(
  text, uuid, text, integer, text, date, timestamptz, text, jsonb)
  from public, anon, authenticated;

alter table public.benefit_definition_revisions
  add column catalog_business_snapshot jsonb generated always as (
    private.make_catalog_revision_snapshot(
      origin_source, origin_template_version_id, origin_template_stable_key,
      origin_template_version, origin_template_hash, origin_verified_on,
      customized_at, terms_timezone, period_value_rules
    )
  ) stored;

-- Closing an immutable revision legitimately recomputes both stored generated
-- snapshots. Keep the original lifecycle authorization and close-transition
-- contract, while excluding only those database-generated values from the
-- row comparison.
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
     or new.valid_to < old.valid_from - 1
     or new.closed_at is null
     or (to_jsonb(new) - array[
          'valid_to', 'closed_at', 'business_snapshot', 'catalog_business_snapshot'
        ]) is distinct from
        (to_jsonb(old) - array[
          'valid_to', 'closed_at', 'business_snapshot', 'catalog_business_snapshot'
        ]) then
    raise exception 'revision rows are immutable except for one authorized close transition'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke all on function private.protect_revision_history() from public, anon, authenticated;

create or replace function private.validate_catalog_revision_chain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_definition_id uuid := case when tg_op = 'DELETE' then old.definition_id else new.definition_id end;
  v_definition_snapshot jsonb;
  v_revision_snapshot jsonb;
begin
  select private.make_catalog_revision_snapshot(
    d.origin_source, d.origin_template_version_id, d.origin_template_stable_key,
    d.origin_template_version, d.origin_template_hash, d.origin_verified_on,
    d.customized_at, d.terms_timezone, d.period_value_rules)
  into v_definition_snapshot
  from public.benefit_definitions d where d.id = v_definition_id;
  if not found then return null; end if;
  select r.catalog_business_snapshot into v_revision_snapshot
  from public.benefit_definition_revisions r
  where r.definition_id = v_definition_id and r.valid_to is null;
  if not found or v_revision_snapshot is distinct from v_definition_snapshot then
    raise exception 'definition % catalog metadata does not match its open immutable revision',
      v_definition_id using errcode = '23514';
  end if;
  return null;
end;
$$;

revoke all on function private.validate_catalog_revision_chain()
  from public, anon, authenticated;
create constraint trigger validate_catalog_revision_chain
after insert or update or delete on public.benefit_definition_revisions
deferrable initially deferred
for each row execute function private.validate_catalog_revision_chain();

-- Rebuild the read model so issuer-fixed terms are evaluated in their snapshot
-- timezone while the user's profile timezone still controls email send cadence.
create or replace view public.benefit_instance_dashboard
with (security_invoker = true)
as
with base as (
  select
    i.id as instance_id, i.definition_id, i.revision_id, i.user_id, r.account_id,
    a.display_name as account_display_name, a.issuer as provider,
    r.name as benefit_name, r.category, r.description, r.notes, r.merchant,
    r.merchant_category, r.website, r.eligibility_notes, r.tags,
    d.active as definition_active, d.recurrence_enabled, r.recurrence_type,
    r.recurrence_basis, r.display_reset_date, r.enrollment_required,
    r.enrollment_deadline, d.enrolled_at, i.occurrence_key, i.instance_version,
    i.supersedes_instance_id, successor.superseded_by_instance_id, i.period_label,
    i.period_start, i.period_end, i.nominal_start, i.nominal_end, i.value_kind,
    r.cashback_percentage, r.minimum_spend, i.available_quantity, i.is_uncapped,
    i.currency, i.unit_label, i.reactivation_eligible, i.manual_completed_at,
    i.voided_at, i.void_reason, coalesce(redemption.total, 0::numeric) as redeemed_quantity,
    (statement_timestamp() at time zone r.terms_timezone)::date as local_today,
    p.recent_reset_days, r.origin_source, r.origin_template_version_id,
    r.origin_template_stable_key, r.origin_template_version, r.origin_template_hash,
    r.origin_verified_on, r.customized_at, r.terms_timezone, r.period_value_rules
  from public.benefit_instances i
  join public.benefit_definitions d on d.id = i.definition_id and d.user_id = i.user_id
  join public.benefit_definition_revisions r
    on r.id = i.revision_id and r.definition_id = i.definition_id and r.user_id = i.user_id
  join public.profiles p on p.user_id = i.user_id
  left join public.accounts a on a.id = r.account_id and a.user_id = r.user_id
  left join lateral (
    select sum(rd.redeemed_quantity) as total from public.redemptions rd
    where rd.benefit_instance_id = i.id and rd.user_id = i.user_id
  ) redemption on true
  left join lateral (
    select newer.id as superseded_by_instance_id from public.benefit_instances newer
    where newer.supersedes_instance_id = i.id and newer.definition_id = i.definition_id
      and newer.user_id = i.user_id
    order by newer.instance_version desc, newer.created_at desc limit 1
  ) successor on true
), calculated as (
  select base.*,
    case when base.is_uncapped then null
      else greatest(base.available_quantity - base.redeemed_quantity, 0) end as remaining_quantity,
    base.redeemed_quantity as earned_to_date,
    base.period_end - base.local_today as days_remaining,
    case when base.voided_at is not null then 'void'
      when base.local_today < base.period_start then 'upcoming'
      when base.local_today <= base.period_end then 'active' else 'expired' end as lifecycle_status,
    case when base.is_uncapped and base.manual_completed_at is not null then 'used'
      when base.is_uncapped and base.redeemed_quantity > 0 then 'partial'
      when base.is_uncapped then 'unused'
      when base.redeemed_quantity = 0 then 'unused'
      when base.redeemed_quantity >= base.available_quantity then 'used' else 'partial' end as usage_status
  from base
)
select
  c.instance_id, c.definition_id, c.revision_id, c.user_id, c.account_id,
  c.account_display_name, c.provider, c.benefit_name, c.category, c.description,
  c.notes, c.merchant, c.merchant_category, c.website, c.eligibility_notes, c.tags,
  c.definition_active, c.recurrence_enabled, c.recurrence_type, c.recurrence_basis,
  c.display_reset_date, c.enrollment_required, c.enrollment_deadline, c.enrolled_at,
  c.occurrence_key, c.instance_version, c.supersedes_instance_id,
  c.superseded_by_instance_id, c.period_label, c.period_start, c.period_end,
  c.nominal_start, c.nominal_end, c.value_kind, c.cashback_percentage,
  c.minimum_spend, c.available_quantity, c.redeemed_quantity, c.remaining_quantity,
  c.earned_to_date, c.is_uncapped, c.currency, c.unit_label,
  c.manual_completed_at as manually_completed_at, c.voided_at, c.void_reason,
  c.voided_at is null as is_live, c.voided_at is not null as is_audit_version,
  c.lifecycle_status, c.usage_status, c.days_remaining,
  c.lifecycle_status = 'active' and c.usage_status <> 'used'
    and c.days_remaining between 0 and 7 as expiring_in_7_days,
  c.lifecycle_status = 'active' and c.usage_status <> 'used'
    and c.days_remaining between 0 and 30 as expiring_in_30_days,
  c.lifecycle_status = 'active'
    and c.period_start between c.local_today - c.recent_reset_days and c.local_today as recently_activated,
  c.voided_at is null and c.definition_active and c.recurrence_enabled and exists (
    select 1 from public.benefit_instances next_i
    where next_i.definition_id = c.definition_id and next_i.user_id = c.user_id
      and next_i.voided_at is null and next_i.period_start > c.local_today
      and next_i.period_start <= c.local_today + 7
  ) as reset_soon,
  c.enrollment_deadline - c.local_today as enrollment_days_remaining,
  c.voided_at is null and c.definition_active and c.enrollment_required
    and c.enrolled_at is null and c.enrollment_deadline is not null
    and c.enrollment_deadline < c.local_today as enrollment_missed,
  c.voided_at is null and c.definition_active and c.enrollment_required
    and c.enrolled_at is null and c.enrollment_deadline is not null
    and c.enrollment_deadline between c.local_today and c.local_today + 7 as enrollment_due_7_days,
  c.voided_at is null and c.definition_active and c.enrollment_required
    and c.enrolled_at is null and c.enrollment_deadline is not null
    and c.enrollment_deadline between c.local_today + 8 and c.local_today + 30 as enrollment_due_30_days,
  c.voided_at is null and c.definition_active and c.enrollment_required
    and c.enrolled_at is null and c.enrollment_deadline is not null
    and c.enrollment_deadline <= c.local_today + 30 as enrollment_needs_attention,
  c.voided_at is null and c.definition_active and c.enrollment_required
    and c.enrolled_at is null and c.enrollment_deadline is not null
    and c.enrollment_deadline between c.local_today and c.local_today + 7 as enrollment_due,
  concat_ws(' ', c.benefit_name, c.account_display_name, c.provider, c.category,
    c.merchant, c.merchant_category, c.website, array_to_string(c.tags, ' '),
    c.description, c.notes, c.eligibility_notes) as search_text,
  c.origin_source, c.origin_template_version_id, c.origin_template_stable_key,
  c.origin_template_version, c.origin_template_hash, c.origin_verified_on,
  c.customized_at, c.terms_timezone, c.period_value_rules
from calculated c;

revoke all on public.benefit_instance_dashboard from public, anon;
grant select on public.benefit_instance_dashboard to authenticated;

create or replace view public.benefit_instance_overview
with (security_invoker = true)
as select * from public.benefit_instance_dashboard d where d.is_live;

revoke all on public.benefit_instance_overview from public, anon;
grant select on public.benefit_instance_overview to authenticated;

alter function public.import_backup(jsonb, text, text) rename to import_backup_legacy;
revoke all on function public.import_backup_legacy(jsonb, text, text)
  from public, anon, authenticated;

create or replace function public.import_backup(
  p_backup jsonb,
  p_duplicate_policy text default 'skip',
  p_current_notification_policy text default 'suppress_current'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer;
  v_item jsonb;
  v_warnings text[] := '{}';
  v_result jsonb;
  v_legacy_backup jsonb;
  v_import_marker constant text := '__perkledger_import_source__:';
begin
  if p_backup is null or jsonb_typeof(p_backup) <> 'object' then
    raise exception 'backup must be a JSON object' using errcode = '22023';
  end if;
  if not (p_backup ? 'schema_version') or p_backup->>'schema_version' is null then
    raise exception 'backup schema_version is required' using errcode = '22023';
  end if;
  begin
    v_version := (p_backup->>'schema_version')::integer;
  exception when invalid_text_representation then
    raise exception 'unsupported backup schema version' using errcode = '22023';
  end;
  if v_version is null or v_version not in (1, 2) then
    raise exception 'unsupported backup schema version' using errcode = '22023';
  end if;
  if v_version = 2 then
    for v_item in select value from jsonb_array_elements(coalesce(p_backup->'accounts', '[]'::jsonb)) loop
      if nullif(v_item->>'origin_product_version_id', '') is not null and not exists (
        select 1 from private.card_catalog_product_versions p
        where p.id = (v_item->>'origin_product_version_id')::uuid
          and p.stable_key = v_item->>'origin_product_stable_key'
          and p.version = nullif(v_item->>'origin_product_version', '')::integer
          and p.content_hash = v_item->>'origin_product_hash'
      ) then
        v_warnings := array_append(v_warnings,
          'Account catalog provenance was cleared because the exact product version is not installed.');
      end if;
    end loop;
    for v_item in select value from jsonb_array_elements(coalesce(p_backup->'definitions', '[]'::jsonb)) loop
      if nullif(v_item->>'origin_template_version_id', '') is not null and not exists (
        select 1 from private.card_catalog_template_versions t
        where t.id = (v_item->>'origin_template_version_id')::uuid
          and t.stable_key = v_item->>'origin_template_stable_key'
          and t.version = nullif(v_item->>'origin_template_version', '')::integer
          and t.content_hash = v_item->>'origin_template_hash'
      ) then
        v_warnings := array_append(v_warnings,
          'Benefit template provenance was cleared because the exact template version is not installed.');
      end if;
    end loop;
    for v_item in select value from jsonb_array_elements(coalesce(p_backup->'revisions', '[]'::jsonb)) loop
      if nullif(v_item->>'origin_template_version_id', '') is not null and not exists (
        select 1 from private.card_catalog_template_versions t
        where t.id = (v_item->>'origin_template_version_id')::uuid
          and t.stable_key = v_item->>'origin_template_stable_key'
          and t.version = nullif(v_item->>'origin_template_version', '')::integer
          and t.content_hash = v_item->>'origin_template_hash'
      ) then
        v_warnings := array_append(v_warnings,
          'Benefit revision template provenance was cleared because the exact template version is not installed.');
      end if;
    end loop;
    perform set_config('app.import_catalog_backup', p_backup::text, true);
  end if;
  v_legacy_backup := jsonb_set(p_backup, '{schema_version}', '1'::jsonb);
  if v_version = 2 then
    -- The legacy importer creates its source-id maps only after each insert.
    -- Carry the exact exported identity through the insert in a temporary marker,
    -- then remove/restore it in the BEFORE INSERT triggers above. This avoids any
    -- name/date matching when names are duplicated.
    v_legacy_backup := jsonb_set(v_legacy_backup, '{accounts}', coalesce((
      select jsonb_agg(item || jsonb_build_object(
        'notes', v_import_marker || (item->>'id')
      ))
      from jsonb_array_elements(coalesce(p_backup->'accounts', '[]'::jsonb)) item
    ), '[]'::jsonb));
    v_legacy_backup := jsonb_set(v_legacy_backup, '{definitions}', coalesce((
      select jsonb_agg(
        (item - array[
          'origin_source','origin_template_version_id','origin_template_stable_key',
          'origin_template_version','origin_template_hash','origin_verified_on','customized_at',
          'terms_timezone','period_value_rules'
        ]) || jsonb_build_object('tags',
          coalesce(item->'tags', '[]'::jsonb) || jsonb_build_array(v_import_marker || (item->>'id')))
      ) from jsonb_array_elements(coalesce(p_backup->'definitions', '[]'::jsonb)) item
    ), '[]'::jsonb));
    v_legacy_backup := jsonb_set(v_legacy_backup, '{revisions}', coalesce((
      select jsonb_agg(
        (item - array[
          'origin_source','origin_template_version_id','origin_template_stable_key',
          'origin_template_version','origin_template_hash','origin_verified_on','customized_at',
          'terms_timezone','period_value_rules','catalog_business_snapshot'
        ]) || jsonb_build_object('tags',
          coalesce(item->'tags', '[]'::jsonb) || jsonb_build_array(v_import_marker || (item->>'id')))
      ) from jsonb_array_elements(coalesce(p_backup->'revisions', '[]'::jsonb)) item
    ), '[]'::jsonb));
  end if;
  v_result := public.import_backup_legacy(
    v_legacy_backup,
    p_duplicate_policy, p_current_notification_policy);
  perform set_config('app.import_catalog_backup', '', true);
  return v_result || jsonb_build_object('source_schema_version', v_version,
    'provenance_warnings', to_jsonb(array(select distinct value from unnest(v_warnings) value)));
exception when others then
  perform set_config('app.import_catalog_backup', '', true);
  raise;
end;
$$;

revoke all on function public.import_backup(jsonb, text, text) from public, anon;
grant execute on function public.import_backup(jsonb, text, text) to authenticated;

alter function public.scheduler_prepare_work(uuid, integer)
  rename to scheduler_prepare_work_legacy;
revoke all on function public.scheduler_prepare_work_legacy(uuid, integer)
  from public, anon, authenticated, service_role;

create or replace function public.scheduler_prepare_work(
  p_job_run_id uuid,
  p_generation_month_limit integer default 24
)
returns table (
  generated_instances integer,
  scheduled_notifications integer,
  skipped_notifications integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_legacy record;
  v_definition record;
  v_rows integer := 0;
  v_new_rows integer := 0;
  v_generated integer := 0;
  v_from date;
  v_through date;
begin
  select * into v_legacy from public.scheduler_prepare_work_legacy(
    p_job_run_id, p_generation_month_limit);

  -- The pre-catalog scheduler uses the profile zone to choose its generation
  -- window. Fill any missing issuer-controlled periods using each active
  -- revision's terms zone. Unique occurrence constraints keep this idempotent.
  for v_definition in
    select d.id, d.interval_months, r.terms_timezone,
      latest.last_nominal_end,
      (statement_timestamp() at time zone r.terms_timezone)::date as terms_today
    from public.benefit_definitions d
    join public.benefit_definition_revisions r
      on r.definition_id = d.id and r.revision_no = d.current_revision_no
    left join lateral (
      select max(i.nominal_end) as last_nominal_end
      from public.benefit_instances i where i.definition_id = d.id and i.voided_at is null
    ) latest on true
    where d.active and d.recurrence_enabled and d.recurrence_type <> 'one_time'
    order by d.id
  loop
    v_from := coalesce(v_definition.last_nominal_end + 1,
      (v_definition.terms_today - make_interval(months => p_generation_month_limit))::date);
    v_through := greatest(v_definition.terms_today + 31,
      (v_definition.terms_today + make_interval(months => v_definition.interval_months))::date);
    if v_from <= v_through then
      v_generated := v_generated + private.materialize_definition(
        v_definition.id, v_from, v_through, 'scheduler', true, false);
    end if;
  end loop;

  -- Reconcile values/timezone eligibility even if this database session had an
  -- already-cached plan for the pre-catalog materializer before the migration.
  update public.benefit_instances i
  set available_quantity = coalesce(
        (select (rule->>'available_quantity')::numeric
         from jsonb_array_elements(r.period_value_rules) rule
         where (rule->>'calendar_month')::integer = extract(month from i.nominal_start)::integer),
        case when r.value_kind = 'percentage_cashback' then r.cashback_cap else r.benefit_amount end
      )
  from public.benefit_definition_revisions r
  where i.revision_id = r.id and i.voided_at is null;

  insert into public.notifications (
    benefit_instance_id, user_id, notification_type, scheduled_for, eligibility_date, state
  )
  select i.id, i.user_id, 'expiration_7_day'::public.notification_type,
    ((i.period_end - 7)::timestamp at time zone r.terms_timezone),
    i.period_end - 7, 'pending'::public.notification_state
  from public.benefit_instances i
  join public.benefit_definitions d on d.id = i.definition_id and d.user_id = i.user_id
  join public.benefit_definition_revisions r on r.id = i.revision_id
  join public.profiles p on p.user_id = i.user_id
  left join lateral (
    select coalesce(sum(rd.redeemed_quantity), 0) as redeemed
    from public.redemptions rd where rd.benefit_instance_id = i.id
  ) usage on true
  where i.voided_at is null and d.active and p.expiration_reminders_enabled
    and d.expiration_reminder_enabled and not i.expiration_notification_suppressed
    and (statement_timestamp() at time zone r.terms_timezone)::date <= i.period_end
    and ((not i.is_uncapped and usage.redeemed < i.available_quantity)
      or (i.is_uncapped and i.manual_completed_at is null))
  on conflict (benefit_instance_id, notification_type) do update
    set scheduled_for = excluded.scheduled_for, eligibility_date = excluded.eligibility_date,
      state = 'pending', next_attempt_at = null, last_error = null, last_error_category = null
  where notifications.first_attempt_at is null and notifications.state <> 'superseded';
  get diagnostics v_rows = row_count;

  insert into public.notifications (
    benefit_instance_id, user_id, notification_type, scheduled_for, eligibility_date, state
  )
  select i.id, i.user_id, 'reactivation'::public.notification_type,
    (i.period_start::timestamp at time zone r.terms_timezone),
    i.period_start, 'pending'::public.notification_state
  from public.benefit_instances i
  join public.benefit_definitions d on d.id = i.definition_id and d.user_id = i.user_id
  join public.benefit_definition_revisions r on r.id = i.revision_id
  join public.profiles p on p.user_id = i.user_id
  left join lateral (
    select coalesce(sum(rd.redeemed_quantity), 0) as redeemed
    from public.redemptions rd where rd.benefit_instance_id = i.id
  ) usage on true
  where i.voided_at is null and i.reactivation_eligible and d.active
    and p.reactivation_reminders_enabled and d.reactivation_reminder_enabled
    and (statement_timestamp() at time zone r.terms_timezone)::date <= i.period_end
    and ((not i.is_uncapped and usage.redeemed < i.available_quantity)
      or (i.is_uncapped and i.manual_completed_at is null))
  on conflict (benefit_instance_id, notification_type) do update
    set scheduled_for = excluded.scheduled_for, eligibility_date = excluded.eligibility_date,
      state = 'pending', next_attempt_at = null, last_error = null, last_error_category = null
  where notifications.first_attempt_at is null and notifications.state <> 'superseded';
  get diagnostics v_new_rows = row_count;
  v_rows := v_rows + v_new_rows;

  update public.notifications n set state = 'skipped', next_attempt_at = null
  from public.benefit_instances i
  join public.benefit_definition_revisions r on r.id = i.revision_id
  where n.benefit_instance_id = i.id and n.first_attempt_at is null
    and n.state <> 'superseded'
    and (statement_timestamp() at time zone r.terms_timezone)::date > i.period_end;
  get diagnostics v_new_rows = row_count;

  generated_instances := v_legacy.generated_instances + v_generated;
  scheduled_notifications := v_legacy.scheduled_notifications + v_rows;
  skipped_notifications := v_legacy.skipped_notifications + v_new_rows;
  update private.job_runs j
  set counts = j.counts || jsonb_build_object(
    'generated_instances', generated_instances,
    'scheduled_notifications', scheduled_notifications,
    'skipped_notifications', skipped_notifications
  ), heartbeat_at = statement_timestamp()
  where j.id = p_job_run_id;
  return next;
end;
$$;

revoke all on function public.scheduler_prepare_work(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.scheduler_prepare_work(uuid, integer) to service_role;

-- Claim eligibility and email day counts are issuer-term calculations. Profile
-- timezone remains the scheduler delivery preference, but must not move a fixed
-- issuer period across a date boundary.
create or replace function public.scheduler_claim_notifications(
  p_job_run_id uuid,
  p_batch_size integer default 25,
  p_lease_seconds integer default 900,
  p_from_email text default null
)
returns table (
  notification_id uuid,
  claim_token uuid,
  idempotency_key uuid,
  frozen_payload jsonb,
  frozen_payload_text text,
  payload_sha256 text,
  first_attempt_at timestamptz,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate record;
  v_claim uuid;
  v_key uuid;
  v_recipient text;
  v_subject text;
  v_text text;
  v_html text;
  v_payload jsonb;
  v_payload_text text;
  v_hash text;
  v_first timestamptz;
  v_attempt integer;
  v_remaining numeric;
  v_earned numeric;
  v_account text;
  v_days integer;
begin
  if p_batch_size < 1 or p_batch_size > 100 then
    raise exception 'batch size must be between 1 and 100' using errcode = '22023';
  end if;
  if p_lease_seconds < 60 or p_lease_seconds > 1800 then
    raise exception 'lease must be between 60 and 1800 seconds' using errcode = '22023';
  end if;
  if p_from_email is null or length(btrim(p_from_email)) not between 3 and 320 then
    raise exception 'from email is required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from private.job_runs j where j.id = p_job_run_id and j.status = 'running'
  ) then
    raise exception 'running job not found' using errcode = 'P0002';
  end if;

  with expired_claims as (
    update public.notifications n
    set state = case
        when statement_timestamp() >= n.first_attempt_at + interval '24 hours'
          then 'requires_review'::public.notification_state
        else 'ambiguous'::public.notification_state
      end,
      claim_token = null,
      claimed_at = null,
      lease_expires_at = null,
      next_attempt_at = case
        when statement_timestamp() >= n.first_attempt_at + interval '24 hours' then null
        else statement_timestamp()
      end,
      last_error_category = 'lease_expired',
      last_error = 'Previous claim lease expired before a durable outcome was recorded.'
    where n.state = 'processing'
      and n.lease_expires_at <= statement_timestamp()
    returning n.id, n.state
  )
  update private.notification_attempts a
  set finished_at = statement_timestamp(),
      outcome = e.state::text,
      error_category = 'lease_expired'
  from expired_claims e
  where a.notification_id = e.id and a.finished_at is null;

  update public.notifications n
  set state = 'requires_review', next_attempt_at = null,
      claim_token = null, claimed_at = null, lease_expires_at = null
  where n.state in ('retryable_failed', 'ambiguous')
    and n.first_attempt_at + interval '24 hours' <= statement_timestamp();

  for v_candidate in
    select
      n.id as notification_id,
      n.notification_type,
      n.first_attempt_at,
      n.attempt_count,
      n.idempotency_key,
      n.frozen_payload,
      n.frozen_payload_text,
      n.payload_sha256,
      i.id as instance_id,
      i.period_start,
      i.period_end,
      i.available_quantity,
      i.is_uncapped,
      i.currency,
      i.unit_label,
      i.manual_completed_at,
      r.name as benefit_name,
      r.notes,
      r.eligibility_notes,
      coalesce(a.display_name, a.issuer, 'Unassigned account') as account_name,
      lower(u.email) as recipient,
      (statement_timestamp() at time zone r.terms_timezone)::date as terms_today,
      coalesce(usage.redeemed, 0) as redeemed
    from public.notifications n
    join public.benefit_instances i
      on i.id = n.benefit_instance_id and i.user_id = n.user_id
    join public.benefit_definitions d
      on d.id = i.definition_id and d.user_id = i.user_id
    join public.benefit_definition_revisions r
      on r.id = i.revision_id and r.definition_id = i.definition_id and r.user_id = i.user_id
    join public.profiles p on p.user_id = i.user_id
    join auth.users u on u.id = i.user_id
      and u.email_confirmed_at is not null and u.email is not null
    left join public.accounts a on a.id = r.account_id and a.user_id = r.user_id
    left join lateral (
      select sum(redemption.redeemed_quantity) as redeemed
      from public.redemptions redemption where redemption.benefit_instance_id = i.id
    ) usage on true
    where n.state in ('pending', 'retryable_failed', 'ambiguous')
      and n.scheduled_for <= statement_timestamp()
      and (n.next_attempt_at is null or n.next_attempt_at <= statement_timestamp())
      and (n.first_attempt_at is null
        or n.first_attempt_at + interval '24 hours' > statement_timestamp())
      and i.voided_at is null
      and d.active
      and (statement_timestamp() at time zone r.terms_timezone)::date
        between i.period_start and i.period_end
      and (
        (not i.is_uncapped and coalesce(usage.redeemed, 0) < i.available_quantity)
        or (i.is_uncapped and i.manual_completed_at is null)
      )
      and (
        (n.notification_type = 'expiration_7_day'
          and p.expiration_reminders_enabled and d.expiration_reminder_enabled
          and not i.expiration_notification_suppressed)
        or
        (n.notification_type = 'reactivation'
          and p.reactivation_reminders_enabled and d.reactivation_reminder_enabled
          and i.reactivation_eligible
          and (statement_timestamp() at time zone r.terms_timezone)::date >= i.period_start)
      )
    order by n.scheduled_for, n.id
    for update of n, i skip locked
    limit p_batch_size
  loop
    v_claim := extensions.gen_random_uuid();
    v_first := coalesce(v_candidate.first_attempt_at, statement_timestamp());
    v_key := coalesce(v_candidate.idempotency_key, extensions.gen_random_uuid());
    v_attempt := v_candidate.attempt_count + 1;

    if v_candidate.first_attempt_at is null then
      v_recipient := v_candidate.recipient;
      v_account := v_candidate.account_name;
      v_earned := v_candidate.redeemed;
      v_remaining := case when v_candidate.is_uncapped then null
        else greatest(v_candidate.available_quantity - v_candidate.redeemed, 0) end;
      v_days := v_candidate.period_end - v_candidate.terms_today;

      if v_candidate.notification_type = 'expiration_7_day' then
        v_subject := 'Benefit expiring soon: ' || v_candidate.benefit_name;
        v_text := v_candidate.benefit_name || E'\nAccount/provider: ' || v_account
          || E'\nRemaining: ' || case when v_candidate.is_uncapped
            then 'Uncapped (earned to date: ' || v_earned::text || ' ' || v_candidate.unit_label || ')'
            else v_remaining::text || ' ' || v_candidate.unit_label end
          || E'\nExpiration date: ' || v_candidate.period_end::text
          || E'\nDays remaining: ' || v_days::text
          || case when coalesce(v_candidate.eligibility_notes, v_candidate.notes) is null then ''
            else E'\nNotes: ' || coalesce(v_candidate.eligibility_notes, v_candidate.notes) end;
      else
        v_subject := 'Benefit available again: ' || v_candidate.benefit_name;
        v_text := v_candidate.benefit_name || E'\nAccount/provider: ' || v_account
          || E'\nNew amount: ' || case when v_candidate.is_uncapped then 'Uncapped'
            else v_candidate.available_quantity::text || ' ' || v_candidate.unit_label end
          || E'\nBenefit period: ' || v_candidate.period_start::text || ' through '
          || v_candidate.period_end::text
          || E'\nExpiration date: ' || v_candidate.period_end::text;
      end if;

      v_html := '<p><strong>' || private.html_escape(v_candidate.benefit_name) || '</strong></p>'
        || '<p>' || replace(private.html_escape(v_text), E'\n', '<br>') || '</p>';
      v_payload := jsonb_build_object(
        'from', btrim(p_from_email),
        'to', jsonb_build_array(v_recipient),
        'subject', v_subject,
        'text', v_text,
        'html', v_html
      );
      v_payload_text := v_payload::text;
      v_hash := pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(v_payload_text, 'UTF8'), 'sha256'), 'hex');
    else
      v_payload := v_candidate.frozen_payload;
      v_payload_text := v_candidate.frozen_payload_text;
      v_hash := v_candidate.payload_sha256;
      v_recipient := null;
      v_subject := null;
      v_text := null;
      v_html := null;
    end if;

    update public.notifications n set
      state = 'processing',
      recipient = coalesce(n.recipient, v_recipient),
      subject = coalesce(n.subject, v_subject),
      rendered_text = coalesce(n.rendered_text, v_text),
      rendered_html = coalesce(n.rendered_html, v_html),
      frozen_payload = coalesce(n.frozen_payload, v_payload),
      frozen_payload_text = coalesce(n.frozen_payload_text, v_payload_text),
      payload_sha256 = coalesce(n.payload_sha256, v_hash),
      idempotency_key = coalesce(n.idempotency_key, v_key),
      first_attempt_at = coalesce(n.first_attempt_at, v_first),
      attempt_count = v_attempt,
      claim_token = v_claim,
      claimed_at = statement_timestamp(),
      lease_expires_at = statement_timestamp() + make_interval(secs => p_lease_seconds),
      next_attempt_at = null,
      last_error = null,
      last_error_category = null
    where n.id = v_candidate.notification_id;

    insert into private.notification_attempts (
      notification_id, job_run_id, attempt_no, claim_token
    ) values (v_candidate.notification_id, p_job_run_id, v_attempt, v_claim);

    notification_id := v_candidate.notification_id;
    claim_token := v_claim;
    idempotency_key := v_key;
    frozen_payload := v_payload;
    frozen_payload_text := v_payload_text;
    payload_sha256 := v_hash;
    first_attempt_at := v_first;
    attempt_count := v_attempt;
    return next;
  end loop;

  update private.job_runs j set heartbeat_at = statement_timestamp()
  where j.id = p_job_run_id;
end;
$$;

revoke all on function public.scheduler_claim_notifications(uuid, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.scheduler_claim_notifications(uuid, integer, integer, text)
  to service_role;
