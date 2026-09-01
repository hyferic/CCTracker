# Card catalog coverage

Reviewed: 2026-09-01
Migration: `supabase/migrations/20260901000100_card_catalog_structure.sql`

This report describes the catalog rows installed in this repository. It is an
auditability report, not a claim that every product or benefit offered by an
issuer is covered.

## Installed coverage

The existing catalog remains the source of the current product and benefit
rows. This migration adds structured fields, explicit card types, source
collections, effective dates, verification states, and quality/coverage views
without rewriting the legacy lifecycle payload used to create benefits.

| Scope | Installed rows | Notes |
| --- | ---: | --- |
| Target issuers | 9 | American Express, Chase, Citi, Capital One, Bank of America, Wells Fargo, U.S. Bank, Barclays US, Discover |
| Current products | 17 | Existing catalog rows retained |
| Current benefit templates | 54 | Existing catalog rows retained and normalized |
| Co-branded products | 5 | Hilton Aspire, Marriott Bonvoy Brilliant, United Explorer, Southwest Priority, Delta Reserve |
| Business products | 0 | Schema supports them; no business rows were invented |
| Student products | 0 | Schema supports them; no student rows were invented |
| Wells Fargo / Barclays US / Discover products | 0 | Explicitly recorded as coverage gaps |

All 54 current benefit templates have a normalized value, recurrence type and
basis, and at least one HTTPS source URL derived from the existing catalog
seed. They are intentionally marked `pending`, `limited`, or `contingent`, not
`verified`, because this migration did not independently re-verify each term.
The five co-branded rows are classified as `co_branded`; they remain consumer
products in practical use, but the distinction is preserved for filtering and
future imports.

The authenticated views `public.card_catalog_coverage` and
`public.card_catalog_quality` expose the same evidence to the application.
Their `coverage_basis` states that counts are installed rows only, and
`card_catalog_coverage.current_products` retains a deterministic JSON inventory
of each installed product's stable key, type, source URLs, verification state,
verification date, effective range, normalized metadata, and structured hash.

## Installed product inventory

The following is the complete list of product rows installed by the versioned
catalog migrations. It is an inventory of repository data, not a complete list
of products offered by any issuer. The legacy `official_url` is retained for
compatibility; the normalized `official_product_url` is intentionally blank
when the repository only has a benefits-page URL.

| Issuer | Product (`stable_key`) | Card type | `verified_on` | Official source |
| --- | --- | --- | --- | --- |
| American Express | Platinum Card (`amex-platinum-us-consumer`) | consumer | 2026-08-25 | [benefits page](https://global.americanexpress.com/card-benefits/view-all/platinum) |
| American Express | Gold Card (`amex-gold-us-consumer`) | consumer | 2026-08-25 | [benefits page](https://global.americanexpress.com/card-benefits/view-all/gold) |
| American Express | Blue Cash Preferred (`amex-blue-cash-preferred`) | consumer | 2026-08-25 | [product page](https://www.americanexpress.com/us/credit-cards/card/blue-cash-preferred/) |
| American Express | Hilton Honors Aspire (`hilton-honors-aspire`) | co_branded | 2026-08-25 | [product page](https://www.americanexpress.com/us/credit-cards/card/hilton-honors-aspire/) |
| American Express | Marriott Bonvoy Brilliant (`marriott-bonvoy-brilliant`) | co_branded | 2026-08-25 | [product page](https://www.marriott.com/credit-cards/marriott-bonvoy-brilliant-american-express-card.mi) |
| American Express | Delta SkyMiles Reserve (`delta-skymiles-reserve`) | co_branded | 2026-08-25 | [product page](https://www.americanexpress.com/us/credit-cards/card/delta-skymiles-reserve-american-express-card/) |
| Chase | Sapphire Reserve (`chase-sapphire-reserve`) | consumer | 2026-08-25 | [product page](https://creditcards.chase.com/rewards-credit-cards/sapphire/reserve) |
| Chase | Sapphire Preferred (`chase-sapphire-preferred`) | consumer | 2026-08-25 | [product page](https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred) |
| Chase | United Explorer (`united-explorer`) | co_branded | 2026-08-25 | [product page](https://www.chase.com/personal/credit-cards/united/united-explorer-card) |
| Chase | Southwest Rapid Rewards Priority (`southwest-rapid-rewards-priority`) | co_branded | 2026-08-25 | [product page](https://creditcards.chase.com/travel-credit-cards/southwest/priority) |
| Capital One | Venture X (`capital-one-venture-x`) | consumer | 2026-08-25 | [product page](https://www.capitalone.com/credit-cards/venture-x/) |
| U.S. Bank | Altitude Go (`us-bank-altitude-go`) | consumer | 2026-08-25 | [product page](https://www.usbank.com/credit-cards/altitude-go-visa-signature-credit-card.html) |
| U.S. Bank | Shield (`us-bank-shield`) | consumer | 2026-08-25 | [product page](https://www.usbank.com/credit-cards/shield-visa-credit-card.html) |
| Bank of America | Premium Rewards (`bofa-premium-rewards`) | consumer | 2026-08-25 | [product page](https://www.bankofamerica.com/credit-cards/products/premium-rewards-credit-card/) |
| Bank of America | Premium Rewards Elite (`bofa-premium-rewards-elite`) | consumer | 2026-08-25 | [product page](https://www.bankofamerica.com/credit-cards/products/premium-rewards-elite-credit-card/) |
| Citi | Strata Elite (`citi-strata-elite`) | consumer | 2026-08-25 | [product page](https://www.citi.com/credit-cards/citi-strata-elite-credit-card) |
| Citi | Strata Premier (`citi-strata-premier`) | consumer | 2026-08-25 | [product page](https://www.citi.com/credit-cards/citi-strata-premier-credit-card) |

## Source review log

On 2026-09-01, official issuer product and benefits pages were checked to
confirm the intended source families and to identify coverage gaps. The links
below are research references for future catalog imports; the current catalog
rows were not upgraded to `verified` from search snippets or from this review.

| Issuer | Official reference | Result |
| --- | --- | --- |
| American Express | [Credit cards](https://www.americanexpress.com/us/credit-cards/), [business cards](https://www.americanexpress.com/us/credit-cards/business/) | Product and business source families identified; existing catalog is not exhaustive |
| Chase | [Credit cards](https://creditcards.chase.com/), [business comparison](https://www.chase.com/personal/credit-cards/education/chase-cards/compare-chase-business-credit-cards), [United cards](https://www.chase.com/personal/credit-cards/united) | Product and co-branded source families identified |
| Citi | [Rewards cards](https://www.citi.com/credit-cards/rewards-credit-cards/), [Strata Premier](https://www.citi.com/credit-cards/citi-strata-premier-credit-card), [Strata Elite](https://www.citi.com/credit-cards/citi-strata-elite-credit-card) | Current product source families identified; no rows added without full term review |
| Capital One | [Credit cards](https://www.capitalone.com/credit-cards/), [Venture X](https://www.capitalone.com/credit-cards/venture-x/), [Savor](https://www.capitalone.com/credit-cards/savor/) | Current product source families identified; no rows added without full term review |
| Bank of America | [Credit cards](https://www.bankofamerica.com/credit-cards/), [Premium Rewards](https://www.bankofamerica.com/credit-cards/products/premium-rewards-credit-card/), [Premium Rewards Elite](https://www.bankofamerica.com/credit-cards/products/premium-rewards-elite-credit-card/) | Current product source families identified; no rows added without full term review |
| Wells Fargo | [Account agreements](https://www.wellsfargo.com/credit-cards/agreements/), [Autograph Journey guide](https://www.wellsfargo.com/credit-cards/autograph-journey-visa/guide-to-benefits/) | Gap recorded; no product rows added |
| U.S. Bank | [Consumer cards](https://www.usbank.com/credit-cards.html), [business cards](https://www.usbank.com/business-banking/business-credit-cards.html), [benefits](https://www.usbank.com/credit-cards/benefits.html) | Product and business source families identified; no rows added without full term review |
| Barclays US | No catalog row added | Gap recorded; source set still requires product-level review |
| Discover | [Credit cards](https://www.discover.com/credit-cards/) | Gap recorded; no product rows added |

## Import and verification contract

Future catalog imports should:

1. Add a new product or template version instead of mutating a historical
   version in place.
2. Set `card_type`, `effective_from`, `effective_to`, structured value and
   recurrence fields, merchant scope, eligibility, limits, and at least one
   official HTTPS source.
3. Add source records to the private source-document and join tables with a
   product or benefit role.
4. Keep `verification_state` as `pending`, `limited`, or `contingent` until a
   human has checked the current issuer terms. Only then may it become
   `verified`.
5. Preserve `content_hash` for legacy provenance and use
   `structured_content_hash` for the new normalized fields.

The trigger `private.validate_catalog_template_structure` prevents normalized
fields from drifting away from the legacy payload that the existing account
provisioning path consumes. The quality view reports missing product URLs,
empty merchant scope, and required issuer re-checks rather than silently
claiming completeness.
