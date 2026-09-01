begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

select has_column('private', 'card_catalog_product_versions', 'card_type',
  'catalog products carry an explicit card type');
select has_column('private', 'card_catalog_product_versions', 'official_source_urls',
  'catalog products retain all source URLs');
select has_column('private', 'card_catalog_product_versions', 'verification_state',
  'catalog products expose an honest verification state');
select has_column('private', 'card_catalog_product_versions', 'structured_content_hash',
  'catalog products hash normalized metadata');
select has_column('private', 'card_catalog_template_versions', 'benefit_value',
  'catalog benefits carry a normalized value');
select has_column('private', 'card_catalog_template_versions', 'structured_recurrence_type',
  'catalog benefits carry normalized recurrence');
select has_column('private', 'card_catalog_template_versions', 'merchant_scope',
  'catalog benefits can enumerate merchant scope');
select has_column('private', 'card_catalog_template_versions', 'structured_content_hash',
  'catalog benefits hash normalized metadata');
select has_view('public', 'card_catalog_coverage',
  'catalog coverage view is available');
select has_view('public', 'card_catalog_quality',
  'catalog quality view is available');
select has_column('public', 'card_catalog_coverage', 'current_products',
  'coverage report exposes an auditable installed product inventory');
select has_column('public', 'card_catalog_current', 'product_metadata',
  'current catalog exposes product metadata');
select has_column('public', 'card_catalog_current', 'benefit_metadata',
  'current catalog exposes benefit metadata');

select is((select count(*) from public.card_catalog_coverage), 9::bigint,
  'coverage report includes every named issuer in scope');
select is((select count(distinct product_version_id) from public.card_catalog_current),
  17::bigint, 'structured catalog preserves the existing 17 current products');
select is((select count(*) from public.card_catalog_current), 54::bigint,
  'structured catalog preserves the existing 54 current benefit templates');
select is((select count(*) from private.card_catalog_product_versions
  where card_type = 'co_branded' and is_current and status = 'current'),
  5::bigint, 'co-branded products are classified separately from generic consumer cards');
select is((select count(*) from public.card_catalog_current
  where benefit_value is not null
    and structured_recurrence_type is not null
    and structured_recurrence_basis is not null
    and cardinality(benefit_source_urls) > 0),
  54::bigint, 'every current benefit has normalized value, recurrence, and a source URL');
select is((select count(*) from public.card_catalog_current
  where benefit_verification_state <> 'verified'),
  54::bigint, 'existing benefit rows remain explicitly pending review rather than overstated');
select is((select count(*) from public.card_catalog_current
  where length(product_structured_content_hash) = 64
    and length(benefit_structured_content_hash) = 64),
  54::bigint, 'current catalog rows expose deterministic hashes for normalized metadata');
select is((select count(distinct product_version_id)
  from private.card_catalog_product_sources),
  17::bigint, 'every installed product has a provenance source mapping');
select is((select count(distinct template_version_id)
  from private.card_catalog_template_sources),
  54::bigint, 'every installed benefit has a provenance source mapping');
select is((select current_product_count from public.card_catalog_coverage
  where issuer_key = 'wells-fargo'), 0::bigint,
  'coverage report records Wells Fargo as an in-scope gap');
select is((select current_product_count from public.card_catalog_coverage
  where issuer_key = 'barclays-us'), 0::bigint,
  'coverage report records Barclays US as an in-scope gap');
select is((select current_product_count from public.card_catalog_coverage
  where issuer_key = 'discover'), 0::bigint,
  'coverage report records Discover as an in-scope gap');
select ok((select current_products @> '[{"stable_key":"chase-sapphire-reserve","product_name":"Sapphire Reserve","official_source_urls":["https://creditcards.chase.com/rewards-credit-cards/sapphire/reserve"],"verification_state":"pending","verified_on":"2026-08-25"}]'::jsonb
  from public.card_catalog_coverage where issuer_key = 'chase'),
  'coverage inventory retains product identity, verification state, and date');
select is((select current_products from public.card_catalog_coverage
  where issuer_key = 'barclays-us'), '[]'::jsonb,
  'coverage inventory is empty for an issuer with no installed product rows');
select is((select count(*) from public.card_catalog_coverage
  where jsonb_array_length(current_products) = current_product_count),
  9::bigint, 'coverage inventory length matches the reported current product count');

select throws_ok($sql$
  update private.card_catalog_template_versions
  set benefit_value = benefit_value + 1
  where stable_key = 'amex-gold-uber'
$sql$, '22023', 'catalog payload and structured benefit_value differ',
  'normalized value cannot silently drift from the legacy lifecycle payload');

select throws_ok($sql$
  update private.card_catalog_template_versions
  set benefit_currency = 'EUR'
  where stable_key = 'amex-gold-uber'
$sql$, '22023', 'catalog payload and structured benefit_currency differ',
  'normalized currency cannot silently drift from the legacy lifecycle payload');

select throws_ok($sql$
  update private.card_catalog_template_versions
  set structured_recurrence_type = 'one_time'
  where stable_key = 'amex-gold-uber'
$sql$, '22023', 'catalog payload and structured recurrence_type differ',
  'normalized recurrence type cannot silently drift from the legacy lifecycle payload');

select throws_ok($sql$
  update private.card_catalog_template_versions
  set structured_recurrence_basis = 'anniversary'
  where stable_key = 'amex-gold-uber'
$sql$, '22023', 'catalog payload and structured recurrence_basis differ',
  'normalized recurrence basis cannot silently drift from the legacy lifecycle payload');

select throws_ok($sql$
  update private.card_catalog_template_versions
  set activation_required = not activation_required
  where stable_key = 'amex-gold-uber'
$sql$, '22023', 'catalog payload and activation_required differ',
  'activation requirement cannot silently drift from the legacy lifecycle payload');

select throws_ok($sql$
  update private.card_catalog_template_versions
  set benefit_description = benefit_description || ' drift'
  where stable_key = 'amex-gold-uber'
$sql$, '22023', 'catalog payload and structured benefit_description differ',
  'normalized descriptions cannot silently drift from the legacy lifecycle payload');

select throws_ok($sql$
  update private.card_catalog_template_versions
  set benefit_unit = 'drifted unit'
  where stable_key = 'amex-gold-uber'
$sql$, '22023', 'catalog payload and structured benefit_unit differ',
  'normalized units cannot silently drift from the legacy lifecycle payload');

select throws_ok($sql$
  update private.card_catalog_template_versions
  set reset_strategy = 'fixed'
  where stable_key = 'amex-gold-uber'
$sql$, '22023', 'catalog date strategy and reset strategy differ',
  'reset strategy cannot silently drift from the legacy date strategy');

select throws_ok($sql$
  update private.card_catalog_template_versions
  set eligibility = eligibility || '{"drift": true}'::jsonb
  where stable_key = 'amex-gold-uber'
$sql$, '22023', 'catalog payload and structured eligibility differ',
  'eligibility metadata cannot silently drift from the legacy lifecycle payload');

select throws_ok($sql$
  update private.card_catalog_template_versions
  set limits = limits || '{"drift": true}'::jsonb
  where stable_key = 'amex-gold-uber'
$sql$, '22023', 'catalog payload and structured limits differ',
  'limit metadata cannot silently drift from the legacy lifecycle payload');

select throws_ok($sql$
  update private.card_catalog_template_versions
  set merchant_scope = array['Drifted merchant']
  where stable_key = 'amex-gold-uber'
$sql$, '22023', 'catalog payload and structured merchant_scope differ',
  'merchant scope cannot silently drift from the legacy lifecycle payload');

select throws_ok($sql$
  update private.card_catalog_template_versions
  set official_source_urls = array['https://example.com/drift']
  where stable_key = 'amex-gold-uber'
$sql$, '22023', 'catalog official_url must be retained in official_source_urls',
  'primary catalog sources cannot be silently removed from the audit source list');

select ok((select quality_state = 'pending'
  from public.card_catalog_quality
  where stable_key = 'amex-gold-uber'),
  'quality view marks an unreviewed benefit as pending');
select ok((select 'issuer_recheck_required' = any(issues)
  from public.card_catalog_quality
  where stable_key = 'amex-gold-uber'),
  'quality view makes the recheck requirement actionable');

select * from extensions.finish();
rollback;
