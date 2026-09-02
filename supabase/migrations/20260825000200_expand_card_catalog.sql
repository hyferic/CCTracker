-- Expand the versioned card catalog with issuer-sourced renewal semantics.
-- Calendar benefits use calendar boundaries; anniversary benefits use the
-- account's benefit anniversary, falling back to the recorded renewal date.

insert into private.card_catalog_product_versions
  (id, stable_key, version, issuer, product_name, aliases, annual_fee,
   annual_fee_currency, status, official_url, verified_on, content_hash, is_current)
values
  ('10000000-0000-4000-8000-00000000000d', 'hilton-honors-aspire', 1,
   'American Express', 'Hilton Honors Aspire', array['Hilton Aspire'], 550, 'USD', 'current',
   'https://www.americanexpress.com/us/credit-cards/card/hilton-honors-aspire/', '2026-08-25',
   'pending', true),
  ('10000000-0000-4000-8000-00000000000e', 'marriott-bonvoy-brilliant', 1,
   'American Express', 'Marriott Bonvoy Brilliant', array['Marriott Brilliant'], 650, 'USD', 'current',
   'https://www.marriott.com/credit-cards/marriott-bonvoy-brilliant-american-express-card.mi', '2026-08-25',
   'pending', true),
  ('10000000-0000-4000-8000-00000000000f', 'united-explorer', 1,
   'Chase', 'United Explorer', array['United Explorer Card'], 150, 'USD', 'current',
   'https://www.chase.com/personal/credit-cards/united/united-explorer-card', '2026-08-25',
   'pending', true),
  ('10000000-0000-4000-8000-000000000010', 'southwest-rapid-rewards-priority', 1,
   'Chase', 'Southwest Rapid Rewards Priority', array['Southwest Priority'], 229, 'USD', 'current',
   'https://creditcards.chase.com/travel-credit-cards/southwest/priority', '2026-08-25',
   'pending', true),
  ('10000000-0000-4000-8000-000000000011', 'delta-skymiles-reserve', 1,
   'American Express', 'Delta SkyMiles Reserve', array['Delta Reserve'], 650, 'USD', 'current',
   'https://www.americanexpress.com/us/credit-cards/card/delta-skymiles-reserve-american-express-card/', '2026-08-25',
   'pending', true);

insert into private.card_catalog_template_versions
  (id, stable_key, version, product_version_id, name, summary, payload, date_strategy,
   fixed_start, fixed_end, setup_field, terms_timezone, default_selected, confidence,
   status, official_url, verified_on, content_hash, is_current)
select x.id::uuid, x.stable_key, 1, x.product_id::uuid, x.name, x.summary,
  x.payload, x.date_strategy, x.fixed_start, x.fixed_end, x.setup_field,
  coalesce(x.terms_timezone, 'America/New_York'), x.default_selected, x.confidence,
  'current', x.url, '2026-08-25', 'pending', true
from jsonb_to_recordset($catalog$
[
  {"id":"20000000-0000-4000-8000-000000000029","stable_key":"hilton-aspire-resort-credit","product_id":"10000000-0000-4000-8000-00000000000d","name":"Hilton Resort Credit","summary":"$200 semiannually; calendar year.","payload":{"name":"Hilton Resort Credit","category":"Hotel","value_kind":"money","benefit_amount":200,"currency":"USD","merchant":"Hilton","eligibility_notes":"Eligible purchases at participating Hilton Resorts; issuer terms apply.","recurrence_type":"semiannual","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://global.americanexpress.com/card-benefits/terms/hilton-aspire"},
  {"id":"20000000-0000-4000-8000-00000000002a","stable_key":"hilton-aspire-flight-credit","product_id":"10000000-0000-4000-8000-00000000000d","name":"Flight Credit","summary":"$50 quarterly; calendar year.","payload":{"name":"Flight Credit","category":"Airline","value_kind":"money","benefit_amount":50,"currency":"USD","eligibility_notes":"Eligible airfare purchased directly with an airline or through Amex Travel; issuer terms apply.","recurrence_type":"quarterly","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://global.americanexpress.com/card-benefits/detail/flight-credit/hilton-aspire"},
  {"id":"20000000-0000-4000-8000-00000000002b","stable_key":"hilton-aspire-free-night","product_id":"10000000-0000-4000-8000-00000000000d","name":"Annual Free Night Reward","summary":"One reward after account opening and each card renewal.","payload":{"name":"Annual Free Night Reward","category":"Hotel","value_kind":"membership","benefit_amount":1,"unit_label":"free night reward","eligibility_notes":"Hilton issues the reward after account opening and each card renewal; issuer terms apply.","recurrence_type":"annual","recurrence_basis":"anniversary","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"account_anniversary","setup_field":"benefit_anniversary_date","default_selected":true,"confidence":"high","url":"https://www.americanexpress.com/us/credit-cards/card/hilton-honors-aspire/"},

  {"id":"20000000-0000-4000-8000-00000000002c","stable_key":"marriott-brilliant-dining","product_id":"10000000-0000-4000-8000-00000000000e","name":"Brilliant Dining Credit","summary":"$25 monthly, up to $300 each calendar year.","payload":{"name":"Brilliant Dining Credit","category":"Dining","value_kind":"money","benefit_amount":25,"currency":"USD","merchant":"Restaurants","eligibility_notes":"Eligible restaurant purchases worldwide; issuer terms apply.","recurrence_type":"monthly","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://www.marriott.com/credit-cards/marriott-bonvoy-brilliant-american-express-card.mi"},
  {"id":"20000000-0000-4000-8000-00000000002d","stable_key":"marriott-brilliant-free-night","product_id":"10000000-0000-4000-8000-00000000000e","name":"Annual Free Night Award","summary":"One award every year after card renewal.","payload":{"name":"Annual Free Night Award","category":"Hotel","value_kind":"membership","benefit_amount":1,"unit_label":"free night award","eligibility_notes":"Award is issued each year after the card renewal month; issuer terms apply.","recurrence_type":"annual","recurrence_basis":"anniversary","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"account_anniversary","setup_field":"benefit_anniversary_date","default_selected":true,"confidence":"high","url":"https://www.marriott.com/credit-cards/marriott-bonvoy-brilliant-american-express-card.mi"},
  {"id":"20000000-0000-4000-8000-00000000002e","stable_key":"marriott-brilliant-elite-nights","product_id":"10000000-0000-4000-8000-00000000000e","name":"Elite Night Credits","summary":"25 credits each calendar year.","payload":{"name":"Elite Night Credits","category":"Membership","value_kind":"points","benefit_amount":25,"unit_label":"elite night credits","eligibility_notes":"Credits apply toward Marriott Bonvoy status; issuer and loyalty-program terms apply.","recurrence_type":"annual","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":false,"confidence":"high","url":"https://www.marriott.com/credit-cards/marriott-bonvoy-brilliant-american-express-card.mi"},

  {"id":"20000000-0000-4000-8000-00000000002f","stable_key":"united-explorer-club-passes","product_id":"10000000-0000-4000-8000-00000000000f","name":"United Club One-Time Passes","summary":"Two passes after opening and each cardmember anniversary.","payload":{"name":"United Club One-Time Passes","category":"Membership","value_kind":"membership","benefit_amount":2,"unit_label":"United Club pass","eligibility_notes":"Passes are issued after account opening and on each cardmember anniversary; issuer terms apply.","recurrence_type":"annual","recurrence_basis":"anniversary","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"account_anniversary","setup_field":"benefit_anniversary_date","default_selected":true,"confidence":"high","url":"https://www.chase.com/personal/credit-cards/united/united-explorer-card"},
  {"id":"20000000-0000-4000-8000-000000000030","stable_key":"united-explorer-rideshare","product_id":"10000000-0000-4000-8000-00000000000f","name":"Rideshare Credit","summary":"$5 monthly, up to $60 each calendar year.","payload":{"name":"Rideshare Credit","category":"Transportation","value_kind":"money","benefit_amount":5,"currency":"USD","eligibility_notes":"Enrollment required; eligible rideshare purchases and issuer terms apply.","enrollment_required":true,"recurrence_type":"monthly","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://www.chase.com/personal/credit-cards/united/united-explorer-card"},
  {"id":"20000000-0000-4000-8000-000000000031","stable_key":"united-explorer-hotels","product_id":"10000000-0000-4000-8000-00000000000f","name":"United Hotels Credit","summary":"Up to $100 each anniversary year.","payload":{"name":"United Hotels Credit","category":"Hotel","value_kind":"money","benefit_amount":100,"currency":"USD","merchant":"United Hotels","eligibility_notes":"Two eligible prepaid United Hotels stays may earn up to $50 each; issuer terms apply.","recurrence_type":"annual","recurrence_basis":"anniversary","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"account_anniversary","setup_field":"benefit_anniversary_date","default_selected":true,"confidence":"high","url":"https://www.chase.com/personal/credit-cards/united/united-explorer-card"},
  {"id":"20000000-0000-4000-8000-000000000032","stable_key":"united-explorer-instacart","product_id":"10000000-0000-4000-8000-00000000000f","name":"Instacart Credit","summary":"$10 monthly through December 31, 2027.","payload":{"name":"Instacart Credit","category":"Shopping portal","value_kind":"money","benefit_amount":10,"currency":"USD","merchant":"Instacart","eligibility_notes":"Eligible Instacart purchases and issuer terms apply; benefit currently ends 12/31/27.","recurrence_type":"monthly","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","fixed_start":"2026-01-01","fixed_end":"2027-12-31","default_selected":true,"confidence":"limited","url":"https://www.chase.com/personal/credit-cards/united/united-explorer-card"},

  {"id":"20000000-0000-4000-8000-000000000033","stable_key":"southwest-priority-anniversary-points","product_id":"10000000-0000-4000-8000-000000000010","name":"Anniversary Points","summary":"7,500 points each cardmember anniversary.","payload":{"name":"Anniversary Points","category":"Travel","value_kind":"points","benefit_amount":7500,"unit_label":"Rapid Rewards points","eligibility_notes":"Points are issued each cardmember anniversary; issuer terms apply.","recurrence_type":"annual","recurrence_basis":"anniversary","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"account_anniversary","setup_field":"benefit_anniversary_date","default_selected":true,"confidence":"high","url":"https://creditcards.chase.com/travel-credit-cards/southwest/priority"},
  {"id":"20000000-0000-4000-8000-000000000034","stable_key":"southwest-priority-companion-boost","product_id":"10000000-0000-4000-8000-000000000010","name":"Companion Pass Qualifying Points Boost","summary":"10,000 qualifying points each calendar year.","payload":{"name":"Companion Pass Qualifying Points Boost","category":"Travel","value_kind":"points","benefit_amount":10000,"unit_label":"Companion Pass qualifying points","eligibility_notes":"One boost is available each calendar year; issuer terms and qualifying requirements apply.","recurrence_type":"annual","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://creditcards.chase.com/travel-credit-cards/southwest/priority"},

  {"id":"20000000-0000-4000-8000-000000000035","stable_key":"delta-reserve-resy","product_id":"10000000-0000-4000-8000-000000000011","name":"Resy Credit","summary":"$20 monthly, up to $240 each calendar year.","payload":{"name":"Resy Credit","category":"Dining","value_kind":"money","benefit_amount":20,"currency":"USD","merchant":"Resy","eligibility_notes":"Enrollment required; eligible U.S. Resy purchases and issuer terms apply.","enrollment_required":true,"recurrence_type":"monthly","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://global.americanexpress.com/card-benefits/detail/resy/delta-reserve"},
  {"id":"20000000-0000-4000-8000-000000000036","stable_key":"delta-reserve-rideshare","product_id":"10000000-0000-4000-8000-000000000011","name":"Rideshare Credit","summary":"$10 monthly, up to $120 each calendar year.","payload":{"name":"Rideshare Credit","category":"Transportation","value_kind":"money","benefit_amount":10,"currency":"USD","eligibility_notes":"Enrollment required; eligible U.S. rideshare purchases and issuer terms apply.","enrollment_required":true,"recurrence_type":"monthly","recurrence_basis":"calendar","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"calendar","default_selected":true,"confidence":"high","url":"https://global.americanexpress.com/card-benefits/detail/rideshare-statement-credit/delta-reserve"},
  {"id":"20000000-0000-4000-8000-000000000037","stable_key":"delta-reserve-companion-certificate","product_id":"10000000-0000-4000-8000-000000000011","name":"Companion Certificate","summary":"One certificate after each card renewal.","payload":{"name":"Companion Certificate","category":"Travel","value_kind":"membership","benefit_amount":1,"unit_label":"companion certificate","eligibility_notes":"Certificate is issued each year after card renewal; route and fare restrictions apply.","recurrence_type":"annual","recurrence_basis":"anniversary","expiration_reminder_enabled":true,"reactivation_reminder_enabled":true},"date_strategy":"account_anniversary","setup_field":"benefit_anniversary_date","default_selected":true,"confidence":"high","url":"https://www.americanexpress.com/us/credit-cards/card/delta-skymiles-reserve-american-express-card/"}
]
$catalog$::jsonb) as x(
  id text, stable_key text, product_id text, name text, summary text, payload jsonb,
  date_strategy text, fixed_start date, fixed_end date, setup_field text,
  terms_timezone text, default_selected boolean, confidence text, url text
);

update private.card_catalog_product_versions p
set content_hash = encode(extensions.digest(
  concat_ws('|', p.stable_key, p.version::text, p.issuer, p.product_name,
    p.market_scope, coalesce(p.annual_fee::text, ''), coalesce(p.annual_fee_currency, ''),
    p.status, p.official_url, p.verified_on::text)::bytea,
  'sha256'), 'hex')
where p.stable_key in (
  'hilton-honors-aspire', 'marriott-bonvoy-brilliant', 'united-explorer',
  'southwest-rapid-rewards-priority', 'delta-skymiles-reserve'
);

update private.card_catalog_template_versions t
set content_hash = encode(extensions.digest(
  concat_ws('|', t.stable_key, t.version::text, t.product_version_id::text, t.name,
    t.summary, t.payload::text, t.date_strategy, coalesce(t.fixed_start::text, ''),
    coalesce(t.fixed_end::text, ''), coalesce(t.setup_field, ''), t.terms_timezone,
    t.default_selected::text, t.confidence, t.status, t.official_url,
    t.verified_on::text)::bytea,
  'sha256'), 'hex')
where t.stable_key like 'hilton-aspire-%'
   or t.stable_key like 'marriott-brilliant-%'
   or t.stable_key like 'united-explorer-%'
   or t.stable_key like 'southwest-priority-%'
   or t.stable_key like 'delta-reserve-%';

-- A catalog anniversary template may use the account's recorded renewal date
-- when the user did not separately provide a benefit anniversary date. This is
-- an explicit, reviewable estimate; a supplied benefit anniversary wins.
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
  v_definition_ids uuid[] := '{}'::uuid[];
  v_template_ids uuid[] := '{}'::uuid[];
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
      raise exception 'unsupported template selection field: %' , v_unknown using errcode = '22023';
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
    if v_template.date_strategy = 'account_anniversary'
       and v_account.benefit_anniversary_date is null then
      if v_account.renewal_date is null then
        raise exception 'benefit_anniversary_date is required for selected anniversary benefits'
          using errcode = '22023';
      end if;
      update public.accounts a
      set benefit_anniversary_date = a.renewal_date
      where a.id = v_account.id and a.user_id = v_user_id
      returning * into v_account;
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
    'catalog_verified_on', v_product.verified_on,
    'benefit_anniversary_inferred',
      v_account.benefit_anniversary_date is not null
      and v_account.benefit_anniversary_date = v_account.renewal_date
      and nullif(p_account->>'benefit_anniversary_date', '') is null);
end;
$$;

revoke all on function public.create_account_with_templates(jsonb, uuid, jsonb, boolean)
  from public, anon;
grant execute on function public.create_account_with_templates(jsonb, uuid, jsonb, boolean)
  to authenticated;
