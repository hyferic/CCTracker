-- Deterministic local-only owner and representative benefits.
-- Password authentication is convenient for automated local tests; production uses
-- the documented confirmed-owner PKCE magic-link flow and never runs this seed.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-4111-8111-111111111111',
  'authenticated', 'authenticated', 'owner@example.test',
  extensions.crypt('local-test-password', extensions.gen_salt('bf')),
  statement_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  statement_timestamp(), statement_timestamp(), '', '', '', ''
) on conflict (id) do nothing;

insert into auth.identities (
  id, provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
) values (
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '{"sub":"11111111-1111-4111-8111-111111111111","email":"owner@example.test"}'::jsonb,
  'email', statement_timestamp(), statement_timestamp(), statement_timestamp()
) on conflict do nothing;

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  false
);

insert into public.accounts (
  id, user_id, display_name, issuer, card_service_name, nickname,
  last_four, annual_fee, annual_fee_currency, active, notes
) values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'Sample Travel Card — Personal', 'Sample Bank', 'Travel Rewards', 'Travel',
  '4242', 95.00, 'USD', true,
  'Local demonstration data only; never enter a full card number.'
) on conflict (id) do nothing;

do $$
declare
  v_year_start date := make_date(extract(year from current_date)::integer, 1, 1);
begin
  if not exists (
    select 1 from public.benefit_definitions
    where user_id = '11111111-1111-4111-8111-111111111111'
      and name = 'Sample monthly dining credit'
  ) then
    perform public.create_benefit(jsonb_build_object(
      'account_id', '22222222-2222-4222-8222-222222222222',
      'name', 'Sample monthly dining credit',
      'category', 'Dining',
      'description', 'A seeded fixed monthly credit for local development.',
      'value_kind', 'money',
      'benefit_amount', 15,
      'currency', 'USD',
      'merchant_category', 'Dining',
      'effective_date', v_year_start,
      'recurrence_type', 'monthly',
      'recurrence_basis', 'calendar',
      'interval_months', 1
    ));
  end if;

  if not exists (
    select 1 from public.benefit_definitions
    where user_id = '11111111-1111-4111-8111-111111111111'
      and name = 'Sample uncapped portal offer'
  ) then
    perform public.create_benefit(jsonb_build_object(
      'account_id', '22222222-2222-4222-8222-222222222222',
      'name', 'Sample uncapped portal offer',
      'category', 'Shopping portal',
      'value_kind', 'percentage_cashback',
      'currency', 'USD',
      'cashback_percentage', 10,
      'merchant', 'Example Merchant',
      'effective_date', current_date,
      'end_date', current_date + 30,
      'recurrence_type', 'one_time',
      'recurrence_basis', 'none'
    ));
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claims', '{}', false);
