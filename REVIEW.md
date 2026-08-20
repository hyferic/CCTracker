# Independent Agent 4 QA Review — Round Two

Audit date: 2026-08-19

Scope: the final consensus plan, requirements matrix, React application, domain logic, Supabase schema/RLS/RPCs/Cron, notification Edge Function, import/export paths, tests, GitHub workflows, README, and deployment guide. This was an independent re-review after the first-round `FAIL`. No implementation source was modified.

## Passed requirements

- The final architecture works within GitHub Pages' static-hosting boundary. Pages serves only the React bundle; Supabase provides PostgreSQL persistence, Auth, RLS, Cron, Vault, and Edge execution; Resend performs server-side email delivery. No browser timer, open tab, or powered-on user computer is required for reminders.
- The issuer-neutral data model separates accounts/providers, stable benefit definitions, immutable revisions, versioned period instances, multiple redemptions, and notification events. Historical periods and superseded versions remain auditable rather than being overwritten.
- Fixed-value credits, capped and uncapped percentage cashback, points, memberships, and custom units are represented. Finite remaining balances are derived from redemption sums, while uncapped cashback exposes earned-to-date plus explicit completion.
- Benefit validity and usage are independent dimensions. Upcoming, active, expired, and void lifecycle states do not erase unused, partial, or used history.
- Calendar monthly, quarterly, semiannual, and annual periods use calendar boundaries. Anchored/custom recurrence computes from the original anchor and preserves end-of-month intent instead of adding a fixed number of days.
- The dashboard supplies the required summary, attention area, search, sorting, and card/provider/category/status/expiration/recurrence/usage filters. The operational default is live instances; void/superseded versions are explicitly available as audit history.
- Account management stores only display metadata and optional last four digits. The schema has no full card number, CVV, password, online-banking credential, or transaction credential field.
- Supabase PKCE magic-link authentication is owner-only: public signup and anonymous access are disabled, `shouldCreateUser` is false, and callback exchange occurs before the application router mounts.
- Persistence and authorization are enforced in PostgreSQL through forced RLS, same-owner composite foreign keys, restricted grants, security-invoker views, and narrowly granted `SECURITY DEFINER` RPCs with empty search paths.
- Profile timezone is loaded into shared application state and used by benefit, enrollment, redemption, settings, and audit-date defaults. Server date/status/notification logic uses the saved IANA timezone, defaulting to `America/New_York`.
- Recurrence edits are explicitly scoped to future periods, current-and-future periods, or one period. Revisions and void/replacement versions preserve history; recurrence disable/re-enable keeps current/history and avoids false reactivation messages.
- Notification identity is unique by `(benefit_instance_id, notification_type)`. Claims use leases and row locks; first attempt freezes recipient, subject, bodies, payload hash, and a stable provider idempotency key. Retries reuse identical content/key and stop at the documented 24-hour ambiguity boundary.
- Expiration work selects incomplete active periods at seven local calendar days and supports in-period catch-up. Reactivation mail is created only for genuinely future, pre-generated periods and is held until the local period start. Used, expired, inactive, disabled, voided, backfilled, imported, and re-enabled cases are suppressed as documented.
- Notification recipients are authoritatively restricted to the confirmed Supabase Auth email in v1, with case-insensitive normalization and server-side syntax validation. Resend and service-role credentials stay in server-side secret stores.
- JSON restore is owner-rekeyed, bounded, server-validated, and transactional; incoming notification authority is ignored. CSV account/definition import is also transactional. CSV output neutralizes spreadsheet formula prefixes without converting true negative numeric values into text.
- The optional display/reset date now flows through TypeScript types, validation, forms, definition/revision snapshots, import/export, and detail presentation, while remaining explicitly informational rather than altering recurrence arithmetic.
- Enrollment attention distinguishes missed deadlines, due within seven days, and due within 8–30 days and gives these items dashboard priority.
- GitHub Actions pin third-party actions by commit. CI forces the authenticated E2E suite to run against a freshly migrated/seeded local Supabase project and fails if the real local API URL or publishable key cannot be obtained; recurrence materialization and disable/re-enable are exercised through the UI.
- Deployment documentation gives an ordered GitHub, Supabase, Auth, Vault/Cron, Resend, Pages, Edge, smoke-test, and production-validation checklist. Every variable states where it comes from, where it is entered, and whether browser exposure is safe.

First-round blocker verification:

| Prior finding | Round-two result |
| --- | --- |
| Selected-timezone client defaults | Fixed through `ProfileProvider`/`useBusinessDate`; component/domain tests pass. |
| SQL anchored end-of-month drift | Fixed in `private.anchor_add_months`; the shared TypeScript fixture and matching pgTAP cases cover Jan 31, Feb 28/29, 30-day month ends, non-EOM anchors, negative offsets, and year rollover. |
| Missing optional reset date | Fixed end to end and constrained to the applicable benefit window. |
| No authenticated application E2E | Fixed; CI explicitly sets `E2E_AUTHENTICATED=true` after local Supabase reset and the test covers real Auth, CRUD, recurrence, usage, filtering, deactivation, and atomic import rollback. |
| Voided versions in operational dashboard | Fixed with live-by-default reads and separate labeled audit history. |
| Incomplete enrollment attention | Fixed for missed, 0–7-day, and 8–30-day cases. |
| Unverified notification recipient | Fixed by the authoritative profile RPC and read-only verified recipient UI. |
| CSV formula injection | Fixed with dangerous-prefix escaping and regression tests. |
| Browser-timezone audit dates | Fixed to use the saved profile timezone. |
| Cron caller timeout below Edge default | Fixed: the Cron request timeout is 120 seconds and the documented/default Edge runtime is 110 seconds. |

Executable release gates run during this review:

| Gate | Result |
| --- | --- |
| `npm run format:check` | PASS |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run test:coverage` | PASS — 11 files, 66 tests; 90.92% line/statement, 77.41% branch, 95.55% function coverage |
| `npm run build` | PASS |
| GitHub Pages subpath production build | PASS — generated assets used `/credit-card-benefits-tracker/` and contained no server secret |
| `node scripts/check-secrets.mjs` | PASS — 106 inspected files |
| `npm audit --omit=dev --audit-level=high` | PASS — zero vulnerabilities |
| `npm run test:e2e` | PASS for four local Chromium/WebKit auth-shell tests; the authenticated Chromium project correctly skipped because this reviewer had no local Supabase service |

## Failed requirements

No release-blocking requirement failure was found in the repaired implementation.

The local review environment did not provide Docker/PostgreSQL or Deno, so pgTAP, database lint, Edge unit/integration tests, and the authenticated local-Supabase E2E path could not be executed here. This is an execution-environment limitation, not a product failure: those gates are present in CI, and source inspection confirmed that CI cannot silently skip the authenticated suite.

## Bugs

- No critical or major implementation defect was found.
- **Moderate, test-only reliability:** several pgTAP fixtures build expected dates with the PostgreSQL session's `current_date` while the seeded owner uses `America/New_York` and the application correctly derives `private.local_today` from that profile. If CI runs between UTC midnight and New York midnight, exact-due-date and enrollment-deadline assertions can describe adjacent local dates and fail intermittently. This does not change production date logic, but it can make the backend release gate flaky.
- **Minor:** the UI hides “Record usage” once a live period is expired, although the RPC can safely accept a backdated redemption whose `used_date` is inside that period. Existing historical entries remain editable, but a user who records an old purchase late must currently change dates or use the API.
- **Minor:** an audit/void instance is labeled read-only but still renders “Override this period”; the server correctly rejects the mutation. The control should not appear on an audit version.
- **Minor:** the production bundle succeeds but Vite reports a JavaScript chunk above 500 kB. This is a performance optimization opportunity, not a correctness failure.

## Security concerns

- No release-blocking security issue was found. RLS, grants, ownership constraints, service-role isolation, verified notification addressing, scheduler-secret checking, frozen payload validation, HTML escaping, retry bounds, and import authority stripping are appropriately layered.
- The sole `verify_jwt = false` Edge endpoint is POST-only, sends no CORS permission, compares a high-entropy scheduler secret in constant time, bounds body size/runtime/batches, and receives its service-role/Resend credentials only in Edge secrets.
- The frontend receives only the Supabase project URL and publishable key; these are intentionally browser-safe under RLS. Service-role, database, Resend, SMTP, scheduler, and GitHub tokens are documented as server-only and were not found in the source scan.
- GitHub Pages cannot set every response security header. The application uses a meta CSP and documents this host limitation; a configurable static host remains the appropriate future hardening option if the threat model expands.
- Live owner isolation, sender-domain verification, secret values, and Resend inbox delivery still require the documented production smoke tests because they cannot be proven from a local source audit.

## Missing functionality

No functionality required by the approved v1 plan is missing.

The two minor UI limitations above—late entry of a redemption for an expired period and the audit-version override control—are recommended cleanup, not failures of persistence, recurrence, notification delivery, or historical integrity. Delivery webhooks and arbitrary verified alternate reminder addresses are explicitly future enhancements, not v1 commitments.

## Edge cases

| Required scenario | Result | Evidence |
| --- | --- | --- |
| February, leap years, and 28/29/30/31-day months | PASS | Shared recurrence fixtures plus matching pgTAP assertions cover EOM preservation, clamping, leap/non-leap transitions, and non-EOM anchors. |
| December to January | PASS | Calendar and anchored fixtures use month/year arithmetic from the original anchor. |
| Timezone boundaries | PASS | Profile-context client defaults, named-zone server calculations, and timezone component/domain tests are present. |
| Daylight saving time | PASS by design/source inspection | Business periods and usage are `date`; scheduler instants are `timestamptz` derived from named IANA zones. DST pgTAP assertions inspect New York spring boundaries. |
| Monthly benefit | PASS | Calendar and anchored generation are tested; E2E expects multiple materialized periods. |
| Calendar quarterly benefit | PASS | Quarter-bucket boundaries and recurrence fixtures are tested. |
| Annual calendar benefit | PASS | Calendar-year periods are generated without fixed-day addition. |
| Annual anniversary benefit | PASS | Original-anchor month arithmetic and leap/EOM fixture parity are present. |
| Changing recurrence configuration | PASS | Scoped revision/regeneration voids and replaces affected live periods while retaining audit versions. |
| Disabling and re-enabling recurrence | PASS | Lifecycle pgTAP coverage and forced authenticated E2E verify future removal/regeneration and reactivation suppression. |
| No usage, partial usage, full usage, and multiple partial redemptions | PASS | Domain/component tests and locked redemption RPC tests cover derived balances and over-redemption rejection. |
| Notification already sent | PASS | Attempted payload/identity is immutable and provider acceptance is terminal. |
| Failed or ambiguous email | PASS by source/test inspection | Per-message outcomes, leases, stable retry payload/key, retry windows, review state, and failure isolation are covered. |
| Scheduled job executes twice | PASS | Unique logical keys, `ON CONFLICT`, `SKIP LOCKED`, lease tokens, and duplicate-preparation tests prevent duplicate mail. |
| Benefit expires before processing | PASS | Claim-time eligibility skips ended periods. |
| Benefit is used before reminder | PASS | Preparation and claim recheck finite/uncapped completion and skip unattempted work. |
| Recurring period generated twice | PASS | Deterministic occurrence identity plus one-live-version constraints make materialization idempotent. |
| Deleted/deactivated benefit | PASS | Deactivation skips pending work and preserves history; hard deletion is limited to safe future drafts. |
| Edit current, future, or historical periods | PASS | Current/future scope is explicit, one-period override is versioned, and historical audit rows are immutable rather than silently rewritten. |

## Deployment concerns

- A GitHub Pages build using `VITE_BASE_PATH=/credit-card-benefits-tracker/` succeeded and emitted the expected repository-relative asset paths. The documented project URL, Auth redirect allow-list, and `VITE_APP_BASE_URL` must match the real repository name exactly.
- Docker/PostgreSQL and Deno were unavailable in this reviewer environment. Before production deployment, the GitHub `Database and Edge integration` and forced authenticated E2E jobs must be green on the exact commit being deployed.
- The pgTAP fixture timezone mismatch described under Bugs should be fixed so CI remains reliable at every UTC hour.
- The Edge runtime override currently permits a value above the 120-second Cron caller timeout, while the default/documented value is safely 110 seconds. Keep production at 110 seconds or tighten validation so an operator cannot create a caller/runtime mismatch.
- The live checklist remains mandatory: verify the exact Supabase project reference, run migrations, set Auth allow-lists, store Vault and Edge secrets, verify the Resend sender, install Cron, send a controlled expiration/reactivation email, invoke recovery twice, verify one event/email, test owner isolation, and confirm data survives a Pages redeploy.
- Expected free-tier constraints, Supabase project pausing, Resend limits, GitHub Actions quotas, backup/export responsibilities, and manual recovery are accurately documented.

## Recommended fixes

1. Make pgTAP dates deterministic in the seeded owner's business timezone: set the test session timezone explicitly or derive fixtures and assertions from the same profile-local date helper used by production.
2. Allow a non-void expired instance to open the redemption dialog for a backdated `used_date` inside its period, while continuing to reject future/upcoming or void audit versions.
3. Hide “Override this period” for audit/void instances and retain the authoritative RPC rejection as defense in depth.
4. Cap `NOTIFICATION_MAX_RUNTIME_MS` below the Cron caller timeout, ideally at the documented 110-second operational ceiling.
5. Code-split lower-frequency import/export/settings routes if initial-load performance becomes noticeable.

## Final status

PASS
