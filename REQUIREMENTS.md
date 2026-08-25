# Requirements traceability matrix

`PASS` means the requirement is represented in the repository and has the cited automated check or an explicit manual/live validation where an external account is unavoidable. It does **not** assert that live GitHub, Supabase, DNS, SMTP, or Resend checks have already run and does not override `REVIEW.md`. Agent 4 must execute every local gate and record an independent final `PASS` in `REVIEW.md`; the owner must complete the live checks in `DEPLOYMENT.md`.

## Planning and architecture

| Requirement | Implementation | Test/evidence | Status |
| --- | --- | --- | --- |
| Agent 1 plan, Agent 2 critique, reconsideration, and shared approval before implementation | `PLAN.md`, `PLAN_REVIEW.md`, `PLAN_RECONSIDERATION.md`, `PLAN_FINAL_REVIEW.md`, `PLAN_CONSENSUS.md` | Explicit Agent 1/Agent 2 approvals in `PLAN.md` and `PLAN_CONSENSUS.md` | PASS |
| Static hosting limits explicitly handled | GitHub Pages serves only `dist`; Supabase owns persistence/Auth/Cron/Edge; Resend owns delivery | `README.md` architecture; `vite.config.ts`; deployment workflows | PASS |
| Issuer-neutral, maintainable personal architecture | Generic accounts, definitions, revisions, instances, redemptions, and notifications | Schema/RPC audit; no issuer-specific domain types | PASS |
| Low-maintenance cost and tradeoff documentation | Supabase/Resend/GitHub profiles, backups, pause risk, domain cost | `PLAN.md` §§19–20; `README.md` cost section | PASS |

## Product and user interface

| Requirement | Implementation | Test/evidence | Status |
| --- | --- | --- | --- |
| Responsive dashboard with name, provider/card, category, value/remaining, dates, recurrence, status, and days remaining | `src/pages/DashboardPage.tsx`, `src/components/BenefitTable.tsx`, `src/components/StatusBadge.tsx` | `src/components/BenefitTable.test.tsx`; desktop/mobile auth-shell smoke; production checklist §11 | PASS |
| Upcoming, Available, Partially Used, Used, Expiring Soon, and Expired states | `src/domain/status.ts`; database dashboard view | `src/domain/status.test.ts`; `supabase/tests/002_lifecycle_redemptions_rls.sql` | PASS |
| Clear seven-day, available-unused, used, recently reset, and reset-soon cues | urgent rows/status badges and Needs Attention scoring/labels in dashboard | status and table unit tests; manual dashboard scenario in `DEPLOYMENT.md` §11 | PASS |
| Summary cards and prioritized Needs Attention area | currency totals, 7/30-day counts, unused/uncapped counts, attention scoring | `src/domain/money.test.ts`; manual responsive check | PASS |
| Search, sorting, and filters | dashboard search includes merchant/provider/notes; account, provider, merchant, category, lifecycle, usage, recurrence, expiration, enrollment, active/inactive, and live/audit-version controls | `src/pages/core-flows.test.tsx`; authenticated E2E; production checklist §11 | PASS |
| Clean mobile/desktop behavior and baseline accessibility | semantic forms/table, responsive CSS, reduced motion, touch sizing | `e2e/auth-shell.spec.ts` Axe + 320px checks; `scripts/smoke-pages.mjs`; manual keyboard/screen-reader check | PASS |
| Obvious Add Benefit, Record Usage, Edit, Mark Used, Filter, and Upcoming actions | dashboard, benefit, and instance routes/pages | component/source audit; production checklist §11 | PASS |

## Accounts, benefits, and eligibility

| Requirement | Implementation | Test/evidence | Status |
| --- | --- | --- | --- |
| Separate card/account/provider entity | `accounts` table and `src/pages/AccountsPage.tsx` | schema/RLS pgTAP; `src/domain/validation.test.ts` | PASS |
| Account display name, issuer, service, nickname, last four, fee, renewal, notes, active state | account schema, API mapping, and form | database constraints; form validation; manual CRUD check | PASS |
| No full card number, CVV, password, or bank credentials | schema contains no such fields; UI warnings; four-digit validation | schema audit; validation test; secret scan | PASS |
| Create/edit benefit form with basic, monetary, date, recurrence, eligibility, and reminder fields | `src/pages/BenefitFormPage.tsx`; `src/domain/validation.ts`; lifecycle RPCs | `src/pages/core-flows.test.tsx`; `src/services/api.test.ts`; `src/domain/validation.test.ts`; lifecycle pgTAP | PASS |
| Fixed credit and percentage cashback with optional cap/minimum spend | definition/revision fields; capped/null availability instances; table/detail display rate, cap, and minimum spend | validation, money, and `BenefitTable` tests; SQL fixtures | PASS |
| Points, membership, and custom-unit values | value-kind enums, validation, formatting, and form choices | validation/money tests; schema constraints | PASS |
| Merchant, category, website, tags, and free-text fine print | revision fields; form/detail/search | schema constraints; manual create/search scenario | PASS |
| Effective/end, enrollment deadline, display reset date, and reset/anchor semantics | form/type/API/import fields; constrained definition/revision snapshots; detail display; calendar basis or original `anchor_date` | validation/API/core-flow tests; lifecycle/import pgTAP | PASS |

## Time, recurrence, history, and editing

| Requirement | Implementation | Test/evidence | Status |
| --- | --- | --- | --- |
| Explicit IANA timezone, default `America/New_York` | shared profile context supplies benefit/redemption/enrollment/audit defaults; Temporal date module and local-date SQL | cross-midnight `src/domain/dates.test.ts`; `src/pages/core-flows.test.tsx`; timezone database validation | PASS |
| No implicit UTC/browser parsing for business dates | ISO date-only columns and centralized Temporal helpers | DST/cross-midnight/leap-day date tests; schema type assertions | PASS |
| One-time, monthly, quarterly, semiannual, annual, and custom month recurrence | TS recurrence engine and PostgreSQL materializer | `src/domain/recurrence.test.ts`; lifecycle pgTAP | PASS |
| Calendar periods and anchored recurrence, not expiry plus fixed days | matching TypeScript/PostgreSQL original-anchor end-of-month arithmetic | shared January 31, February 28/29, April 30, August 31, leap-return, and Dec→Jan fixtures in recurrence unit/pgTAP tests | PASS |
| Definition, immutable revision, and instance separation | `benefit_definitions`, `benefit_definition_revisions`, versioned `benefit_instances` | `001_schema_security.sql`; revision/history assertions in `002_lifecycle_redemptions_rls.sql` | PASS |
| Historical periods and usage survive recurrence/reset | immutable snapshots, voided audit versions, redemption rows | lifecycle/edit/deactivation pgTAP; period history UI | PASS |
| Operational dashboard excludes void versions while audit history remains explicit | live-only default, Period versions filter, `is_live`/`is_audit_version`, version/supersession reason labels | `src/pages/core-flows.test.tsx`; lifecycle pgTAP; authenticated E2E | PASS |
| Future/current-and-future edits and audited one-period override | `edit_benefit`/`override_instance` RPCs and scope UI | future and current-boundary revision pgTAP; manual protected-current/override scenario | PASS |
| Disable/re-enable recurrence without corrupting history | `set_recurrence_enabled` and Benefits UI | disable/re-enable/void-history assertions in `002_lifecycle_redemptions_rls.sql` | PASS |
| Deactivate/reactivate and hard-delete only a safe future draft | `set_benefit_active`, `delete_benefit_draft` | `src/pages/core-flows.test.tsx`; `src/services/api.test.ts`; explicit deactivation/history, safe-delete, and started-history rejection assertions in `002_lifecycle_redemptions_rls.sql` | PASS |

## Redemption and status calculations

| Requirement | Implementation | Test/evidence | Status |
| --- | --- | --- | --- |
| Unused, partial, full, and multiple redemption entries | redemption table/RPCs and `src/pages/InstancePage.tsx` | `src/pages/core-flows.test.tsx`; `src/services/api.test.ts`; `src/domain/money.test.ts`; redemption pgTAP | PASS |
| Used date, merchant, description, and notes per redemption | redemption schema and detail form/list | schema constraints; manual CRUD scenario | PASS |
| Remaining value derived without drift and over-redemption rejected | aggregate dashboard view; lock-and-sum RPCs | multiple partial/edit/delete/mark-used/overuse SQL assertions | PASS |
| Uncapped cashback records earned value and requires explicit completion | null availability, `mark_uncapped_complete`, uncapped UI | money/status/table tests; uncapped SQL assertions | PASS |
| Lifecycle validity remains distinct from usage/redemption | independent lifecycle and usage fields in dashboard view | `src/domain/status.test.ts`; SQL partial/used assertions | PASS |
| Missed, 0–7-day, and 8–30-day enrollment attention bands | non-overlapping database flags and prioritized UI labels | status/core-flow tests; lifecycle pgTAP fixtures | PASS |

## Persistence, authentication, and security

| Requirement | Implementation | Test/evidence | Status |
| --- | --- | --- | --- |
| Durable backend persistence across refresh, restart, and frontend deploy | Supabase Postgres migrations and Data API; no localStorage data model | schema tests; live refresh/redeploy check in `DEPLOYMENT.md` §11 | PASS |
| Owner-only magic-link authentication with no client password | PKCE bootstrap, `shouldCreateUser:false`, disabled signup/anonymous config | `src/App.test.tsx`; `e2e/auth-shell.spec.ts`; same-browser live test | PASS |
| Owner-scoped RLS and deny-by-default grants | forced RLS, composite ownership FKs, exact RPC grants | `001_schema_security.sql`; two-owner isolation in `002_lifecycle_redemptions_rls.sql` | PASS |
| Backend validation for invariant-sensitive writes | constrained tables and narrow transactional `SECURITY DEFINER` RPCs | validation/precision/overuse/tamper/import rollback SQL tests | PASS |
| No service-role, mail, database, or scheduler secret in frontend | Edge/Vault/protected environment storage; only `VITE_*` client values | `scripts/check-secrets.mjs`; Pages asset scan; CSP/source review | PASS |
| Restrictive CSP and no raw HTML rendering | `index.html`; React text rendering; server HTML escaping | E2E auth-shell; notification payload/hash SQL tests | PASS |
| Notification recipient is syntactically valid and confirmed | read-only confirmed owner recipient in Settings; database constraint/RPC rejects malformed or different addresses | core-flow test; lifecycle pgTAP recipient assertions | PASS |

## Scheduling and email

| Requirement | Implementation | Test/evidence | Status |
| --- | --- | --- | --- |
| Reminders run with browser/computer closed | Supabase `pg_cron` calls the deployed Edge Function | migration `20260818000700_grants_and_cron.sql`; live Cron check in `DEPLOYMENT.md` §8 | PASS |
| Seven-day expiration email for incomplete active periods | scheduler preparation/claim RPCs, Edge processor, Resend transport | expiration selection/payload/dedup pgTAP; Edge email/processor tests | PASS |
| Catch-up for a benefit entered with fewer than seven days left | due-date eligibility and active-period claim predicate | scheduler SQL audit; live short-window scenario | PASS |
| Available-again email for genuinely new recurring periods | reactivation eligibility survives the due boundary through claim/provider acceptance; available-again payload | existing notification suite plus no-manual-eligibility prepare/claim/accept/no-reclaim regression in `005_card_catalog_templates.sql` | PASS |
| Correct email fields and protected provider key | byte-frozen subject/text/HTML includes benefit/account/value/period/notes as applicable | pgTAP payload checks; `supabase/functions/_shared/email_test.ts` | PASS |
| One logical notification and stable provider idempotency | unique instance/type and idempotency keys; immutable frozen body/hash | duplicate prepare/retry/consumed-claim/reactivation dedup SQL; Edge retry tests | PASS |
| Duplicate jobs, leases, bounded retries, slow providers, and failure isolation | `FOR UPDATE SKIP LOCKED`, claim tokens/leases, stable key, transport/runtime bounds, bounded batches/concurrency | lease-expiry/token/idempotency pgTAP; duplicate/lease/caller-abort processor/handler tests; provider-timeout email test | PASS |
| Used, expired, voided, inactive, or disabled work is suppressed | scheduler eligibility and skip transitions; deactivation RPC | lifecycle/scheduler SQL; production checklist scenarios | PASS |
| Scheduler health, failure audit, and protected recovery | job runs, attempt audit, owner health RPC/UI, manual GitHub workflow | scheduler health pgTAP; Edge HTTP smoke; workflow guard/source audit | PASS |
| Scheduler endpoint secret/method/CORS controls | sole `verify_jwt=false` function, constant-time header, POST-only/no CORS | handler/security tests; `scripts/smoke-edge.mjs` | PASS |

## Portability, deployment, testing, and documentation

| Requirement | Implementation | Test/evidence | Status |
| --- | --- | --- | --- |
| JSON backup/export and safe import | canonical versioned JSON, client preview, owner re-keying, atomic `import_backup` | `src/domain/portability.test.ts`; `004_import_contract.sql` | PASS |
| CSV export | separate accounts/definitions/instances/redemptions downloads | CSV quoting unit test; manual download check | PASS |
| Validated CSV account/definition import | downloadable `record_type` template, same-file `source_id`/`account_source_id` links, pipe-delimited tags, preview, and atomic `import_backup`; recurrence engine creates usable periods | `src/domain/csvImport.test.ts`; materialization and rollback assertions in `004_import_contract.sql`; production checklist §11 | PASS |
| Malformed import cannot partially corrupt data | 5 MiB/5,000-row bounds, client and database validation, transaction rollback, notification authority ignored | `src/domain/csvImport.test.ts`; malformed/reference/oversize/rollback pgTAP and portability unit tests | PASS |
| GitHub repository hygiene and no committed secrets | `.gitignore`, `.env.example`, lockfile, Dependabot, secret scanner | `scripts/check-secrets.mjs`; CI application job | PASS |
| GitHub CI runs formatting, lint, typecheck, unit, database, Edge, E2E, build, audit, and secret gates | `.github/workflows/ci.yml` | workflow definition; final QA must run/observe a clean execution | PASS |
| Repository-path-safe GitHub Pages deployment | Vite base, HashRouter, Pages runs only from a successful backend workflow's exact tested/deployed `head_sha` | production build; `scripts/check-release-order.mjs`; `scripts/smoke-pages.mjs`; live Pages check | PASS |
| Protected database/Edge deployment | exact-ref confirmation, exact-commit successful-CI gate, production environment, lint/dry-run/push/function health | `.github/workflows/deploy-backend.yml`; deployment checklist §8 | PASS |
| Vault-backed Cron and protected manual recovery | named Vault secrets, Cron installer, recovery dispatch confirmation/concurrency | migration `00700`; backend/recovery workflow smoke; live Cron inspection | PASS |
| Cron caller timeout covers bounded processor | `pg_net` timeout 120 seconds; processor maximum 110 seconds | schema pgTAP source assertion; Edge slow-provider/runtime tests; deployment inspection | PASS |
| Authenticated frontend↔Supabase contract coverage | CI derives real local URL/key, signs in seeded owner, and runs account/benefit/redemption/filter/import-rollback flow; auth shell remains Chromium/WebKit | `e2e/authenticated.spec.ts`; `e2e/auth-shell.spec.ts`; `.github/workflows/ci.yml` | PASS |
| CSV export neutralizes formula injection | text cells with `=`, `+`, `-`, or `@` receive spreadsheet-safe prefix while numeric negatives remain numeric | `src/domain/portability.test.ts`; production spreadsheet check | PASS |
| Exact variables, secret sources/destinations, and browser safety documented | `.env.example`; configuration matrix | `DEPLOYMENT.md` configuration audit | PASS |
| Comprehensive setup/update/security/cost/troubleshooting documentation | `README.md`, `DEPLOYMENT.md`, `PLAN.md` | Agent 4 documentation audit | PASS |
| Concrete final deployment and production validation checklist | sequential GitHub/Supabase/Resend/Auth/Cron/Pages/Edge/test-email steps | `DEPLOYMENT.md` §§1–12 | PASS |

## Standard-card catalog amendment

| Requirement | Implementation | Test/evidence | Status |
| --- | --- | --- | --- |
| Exact product selection and automatic benefits | private versioned catalog, `card_catalog_current`, atomic `create_account_with_templates`; three-step Accounts UI | `005_card_catalog_templates.sql`; Accounts component flow | PASS |
| Current issuer-neutral starter catalog | migration-managed Amex/Chase/Capital One/U.S. Bank/BoA/Citi records; current Oura, retired Saks, split DoorDash | catalog SQL assertions and source/verified metadata | PASS |
| Anniversary, fixed, calendar, and contingent dates | separate account benefit anniversary, template date strategies, revision-scoped terms timezone | SQL anniversary/U.S. Bank and Kiritimati-vs-Honolulu date-boundary/claim assertions; recurrence suite | PASS |
| Period-specific value rules | strict server/client grammar and materialization override | malformed rules plus December $35/January $15 pgTAP; validation tests | PASS |
| Provenance and no silent synchronization | exact UUID/key/version/hash snapshots; source-ID-mapped v2 restore; customized marker; immutable origin | duplicate-name exact/degraded import, injection, edit-history, snapshot, and security SQL tests; Benefits UI | PASS |
| Custom/manual benefits remain available | Custom account fallback and `/benefits/new`; same manual lifecycle RPC | catalog-outage component test; existing CRUD/redemption/recurrence suites | PASS |
| Portable schema v2 with v1 compatibility | v2 export/parser; exact-match provenance restore or degradation warning | portability unit and import/catalog SQL tests | PASS |

## Verification commands

Run from a clean checkout. `npm run verify` does not include SQL, Edge, or E2E tests, so do not stop there.

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
node scripts/check-secrets.mjs
npm run build
npm exec -- supabase start
npm exec -- supabase db reset --local
npm exec -- supabase db lint --local --fail-on error
npm run test:sql
npm run test:edge
npm exec -- supabase status -o env > /tmp/perkledger-supabase.env
set -a
. /tmp/perkledger-supabase.env
set +a
export VITE_SUPABASE_URL="${API_URL:-$SUPABASE_URL}"
export VITE_SUPABASE_PUBLISHABLE_KEY="${PUBLISHABLE_KEY:-$ANON_KEY}"
export E2E_AUTHENTICATED=true
npm run test:e2e
npm exec -- supabase stop --no-backup
```

Without Docker, plain `npm run test:e2e` still executes the unauthenticated Chromium/WebKit shell and explicitly skips the authenticated contract. CI always derives real local browser-safe values and sets `E2E_AUTHENTICATED=true`, so a missing backend contract cannot silently pass there.

Live production PKCE, unknown-user rejection, Resend provider acceptance, SMTP, DNS, Vault/Cron heartbeat, recovery concurrency, persistence after a Pages redeploy, encrypted backup, and restore-drill checks are intentionally in `DEPLOYMENT.md` because they require the owner's external accounts and secrets.

Canonical JSON is the full-history restore format. The downloadable CSV template intentionally imports accounts and benefit definitions only; it is validated and committed through the same atomic import RPC, which materializes usable periods. The separate flattened CSV exports remain analysis-oriented and are not claimed to round-trip history or redemptions.
