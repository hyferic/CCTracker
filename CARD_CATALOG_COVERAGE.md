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
Their `coverage_basis` states that counts are installed rows only.

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
