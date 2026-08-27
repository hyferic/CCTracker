# PerkLedger

PerkLedger is a private personal dashboard for credit-card benefits, reimbursements, statement credits, cashback offers, shopping portals, memberships, and other expiring financial perks. It tracks reusable account/provider records, calendar-correct benefit periods, partial usage, history, enrollment, deadlines, and idempotent email reminders.

The app never asks for a full card number, CVV, banking password, or transaction credential.

## Architecture

GitHub Pages serves the compiled React application only. Static Pages cannot persist private data, keep secrets, run scheduled work, or send email. Those responsibilities are deliberately separate:

- React 19, Vite, strict TypeScript, React Router `HashRouter`, Temporal, and Zod provide the responsive frontend.
- Supabase provides PostgreSQL persistence, magic-link and optional passkey Auth, row-level security, transactional RPCs, Vault, Cron, and one Edge Function.
- Resend provides benefit email through its API and authentication email through a separate SMTP credential.
- Supabase Cron calls `process-notifications` at minutes 7, 22, 37, and 52 with a 120-second HTTP timeout covering the processor's 110-second bound. A protected GitHub manual workflow is recovery only.
- GitHub Actions validates the application, local database, Edge Function, and E2E behavior before Pages deployment. Backend deployment is a separately approved production workflow.

```text
GitHub Pages SPA ── authenticated publishable key ──> Supabase Auth/Postgres + RLS
                                                        │
Supabase Cron ── X-Scheduler-Secret ──> Edge Function ──┴──> Resend API
GitHub manual recovery ────────────────┘
```

Recurring definitions and immutable revisions are separate from versioned benefit instances. A January usage record is never overwritten when February becomes available. Redemptions are individual rows; remaining value is derived. Finite limits are enforced under database locks.

## Product capabilities

- Dashboard summaries by currency without inventing exchange rates.
- Dashboard view for live benefits expiring in the current local calendar month, with a quick “Confirm used” action.
- Search across benefit, account, provider, merchant, and notes; sorting and filters for account, provider, merchant, category, lifecycle, usage, recurrence, expiration, enrollment, active/inactive definitions, and live/audit period versions.
- Fixed money, capped or uncapped percentage cashback, points, memberships, and custom-unit benefits.
- Calendar monthly/quarterly/semiannual/annual periods and anchored/custom N-month recurrence.
- End-of-month and leap-day-safe arithmetic using original anchors.
- Explicit `America/New_York` default timezone; the saved profile timezone drives benefit, redemption, enrollment, audit, and notification date defaults while date-only history never shifts.
- Optional display reset dates are stored in definitions/revisions, validated within the benefit window, and shown without changing recurrence arithmetic.
- Missed, due-within-7-days, and due-within-30-days enrollment attention states.
- Scoped recurring edits: future, current-and-future, or an audited one-period override.
- Partial/multiple redemptions, mark-used, uncapped earned-to-date, and explicit uncapped completion.
- Daily rolling expiration digest emails covering the next seven days, plus available-again email events; all use immutable payloads, claims, leases, retry bounds, and provider idempotency keys.
- Account deactivation, benefit/recurrence deactivation, and hard deletion only for safe future drafts.
- Canonical JSON full-history backup/restore, formula-safe flattened CSV analysis exports, and validated template-based CSV import for accounts and benefit definitions. Imports are transactional and ignore incoming notification authority.
- Scheduler health and notification audit views.

## Repository map

```text
src/                       React UI, domain rules, API adapter, tests
e2e/                       Real authenticated contract flow plus Chromium/WebKit auth-shell/a11y tests
supabase/migrations/       Schema, constraints, RLS, RPCs, scheduler, import, Cron
supabase/tests/            pgTAP schema/RLS/lifecycle/scheduler/import tests
supabase/functions/        Deno notification processor and unit/integration tests
scripts/                   Secret and deployment smoke checks
.github/workflows/         CI, Pages, backend, and manual recovery workflows
PLAN.md                    Agreed architecture
DEPLOYMENT.md              Exact production setup and validation checklist
REQUIREMENTS.md            Implementation/test traceability matrix
```

`REVIEW.md` is intentionally created only by the independent Agent 4 audit.

## Local setup

Prerequisites:

- Node.js 20.19 or newer (the lockfile is authoritative).
- Docker Desktop or another Docker-compatible runtime for local Supabase.
- Deno 2.4.5 for direct Edge tests.
- Supabase CLI is pinned as a development dependency.

```bash
git clone <YOUR_REPOSITORY_URL>
cd credit-card-benefits-tracker
npm ci
cp .env.example .env.local
npm exec -- supabase start
npm exec -- supabase db reset --local
npm run dev
```

For local Supabase, put the URL and publishable/anon key printed by `supabase status` into `.env.local`, and keep `VITE_APP_BASE_URL=http://localhost:5173/`. Only the documented `VITE_*` values are browser-safe. Never put a service-role key, Resend key, SMTP password, database password, or scheduler secret in `.env.local` or frontend code.

Local Auth has signup disabled. `supabase/seed.sql` creates the confirmed local owner `owner@example.test` plus representative data. To exercise the signed-in UI, request a link for that address, open local Inbucket at `http://127.0.0.1:54324`, and open the message link in the same browser. Studio is at `http://127.0.0.1:54323`. The seeded password exists only to support local database tooling; the application UI uses magic links.

## Required production accounts

- A GitHub account and repository. Public repositories can use Pages without exposing database rows; verify your GitHub plan before choosing private-source Pages.
- A Supabase project for Postgres, Auth, RLS, Vault, Cron, and the Edge Function.
- A Resend account and a domain you can verify with DNS for Auth and benefit email.
- A password manager or secret vault for the database password, deploy token, SMTP credential, scheduler secret, and Resend API key.

## Configuration overview

The exact obtain/store/browser-safety matrix is in [DEPLOYMENT.md](DEPLOYMENT.md). Required values are:

| Name | Used by | Browser-safe? |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | local Vite and Pages build | Yes |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | local Vite and Pages build | Yes, with the committed RLS/grants |
| `VITE_APP_BASE_URL` | PKCE redirect root | Yes |
| `VITE_BASE_PATH` | Vite asset base; Pages workflow computes it | Yes |
| `RESEND_API_KEY` | Supabase Edge Function | **No** |
| `RESEND_FROM_EMAIL` | Supabase Edge Function | Address is not a credential; keep it server-side |
| `SCHEDULER_SECRET` | Edge Function, Supabase Vault, protected GitHub recovery | **No** |
| `PROCESS_NOTIFICATIONS_URL` | Supabase Vault and GitHub workflow | URL is non-secret; the endpoint still requires the secret header |
| `SUPABASE_ACCESS_TOKEN` | protected backend deployment workflow | **No** |
| `SUPABASE_PROJECT_REF` | backend/recovery workflows | Yes; identifier only |
| `SUPABASE_DB_PASSWORD` | protected backend deployment workflow | **No** |

Supabase injects `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` into its Edge runtime. Never copy the service-role key into a browser variable or GitHub Pages build. Auth SMTP settings and their separate credential live only in Supabase Auth settings.

## Database and email setup

The seven ordered SQL migrations create extensions, owner-scoped tables, immutable revisions, versioned instances, RLS/grants, transactional lifecycle/import RPCs, scheduler RPCs, and the Vault-backed Cron installer. Apply them through the protected backend workflow; do not edit an already deployed migration.

Benefit messages use the Resend HTTP API from `process-notifications`. Magic links use Supabase Auth custom SMTP with a different Resend credential. Verify the sender domain, disable link tracking for Auth messages, set Edge secrets, create the two named Vault entries, deploy the backend, and install/verify the Cron job. GitHub Pages never receives either mail credential.

## Commands

```bash
npm run dev             # local Vite server
npm run format:check    # formatting gate
npm run lint            # strict ESLint gate
npm run typecheck       # strict TypeScript gate
npm test                # Vitest domain/component suite
npm run test:sql        # pgTAP against running local Supabase
npm run test:edge       # Deno Edge suite with fake transport
npm run test:e2e        # Chromium/WebKit auth shell; authenticated flow skips without explicit local config
npm run build           # production Pages bundle
npm run verify          # format, lint, typecheck, Vitest, build (not SQL/Edge/E2E)
node scripts/check-secrets.mjs
```

The CI backend job starts/resets local Supabase, runs database lint and pgTAP, runs the native Deno suite, serves the Edge Function with a guarded fake mail transport, exercises HTTP authorization and RPC orchestration, and stops services. The E2E job derives the actual local API URL and publishable/anon key, signs in the seeded owner with a local-only password grant, then exercises account and benefit create/edit/deactivate, redemption/status/remaining value, dashboard filters, and transactional malformed-import rollback through the real UI, RPCs, RLS, and database. Chromium and WebKit separately run the unauthenticated accessibility shell. Real Resend delivery remains a production validation step.

To run only the unauthenticated cross-browser shell locally, `npm run test:e2e` needs no Supabase stack. To include the authenticated contract after starting/resetting local Supabase, export its browser-safe values and the explicit gate:

```bash
npm exec -- supabase status -o env > /tmp/perkledger-supabase.env
set -a
. /tmp/perkledger-supabase.env
set +a
export VITE_SUPABASE_URL="${API_URL:-$SUPABASE_URL}"
export VITE_SUPABASE_PUBLISHABLE_KEY="${PUBLISHABLE_KEY:-$ANON_KEY}"
export E2E_AUTHENTICATED=true
npm run test:e2e
```

## Authentication and security model

- Production signup and anonymous login are disabled. The owner is created or invited in Supabase Dashboard.
- Magic-link login uses PKCE with `shouldCreateUser: false`. The link must be opened in the same browser/device that requested it.
- Passkeys are an optional, phishing-resistant sign-in method. They are particularly useful for an iPhone Home Screen app because the biometric ceremony and resulting session stay inside that app rather than completing in Safari. Supabase currently labels its passkey API experimental; the client is intentionally pinned at `@supabase/supabase-js` 2.105.0 or newer and opts in explicitly.
- Deny-by-default grants and owner-scoped RLS protect all browser reads. Invariant-sensitive changes use narrowly granted `SECURITY DEFINER` RPCs with empty search paths and server-side validation.
- Same-owner composite foreign keys prevent cross-owner relationships. Revision business snapshots and attempted notification payloads are immutable.
- `process-notifications` is the only `verify_jwt=false` function. It accepts only POST, provides no CORS response, compares a high-entropy scheduler header in constant time, and bounds work.
- Benefit API mail and Auth SMTP use different Resend credentials. Provider/service-role credentials never reach GitHub Pages.
- Benefit notifications use only the confirmed Auth owner email. Settings displays that verified recipient read-only; the server rejects malformed or different custom recipients.
- A restrictive CSP disallows runtime third-party scripts and raw HTML is never rendered.
- Logs omit credentials, private notes, recipients, and email bodies. Run the committed secret scanner before every push.

The browser stores a Supabase refresh token. RLS limits its authority, but same-origin XSS could act as the signed-in owner. Keep dependencies current, review Dependabot changes, sign out on shared devices, and revoke suspicious sessions in Supabase Dashboard.

### Enable passkeys for the deployed Pages app

1. In Supabase Dashboard, open **Authentication → Passkeys**, enable passkeys, and use **PerkLedger** as the relying-party display name.
2. Set **Relying Party ID** to `hyferic.github.io` and **Relying Party Origins** to `https://hyferic.github.io`. The repository path (`/CCTracker/`) is not part of a WebAuthn origin.
3. Sign in once using the existing email link in Safari, open **Settings → Passkey sign-in**, and choose **Add passkey to this device**. Approve the iPhone Face ID/Touch ID/device-passcode prompt.
4. Open the Home Screen app and choose **Sign in with passkey**. Future passkey sign-ins and the persisted session remain in the Home Screen app.

Keep email-link login enabled as recovery access. Never change the relying-party ID after creating a passkey: passkeys are cryptographically bound to it and would need to be enrolled again. This setup uses no browser secret and needs no new environment variable. See [Supabase passkey authentication](https://supabase.com/docs/guides/auth/passkeys) for current platform limitations.

## Notification behavior

Expiration selection targets `period_end - 7` local calendar days and catches up from 0–6 days or longer while the period remains active and incomplete. On initial creation, the current occurrence is not treated as a reactivation, while genuinely future occurrences pre-generated by that creation remain eligible and can send only on or after their local period start. Imported, backfilled, already-ended, and recurrence-re-enabled occurrences remain suppressed because they are not evidence that a benefit just became available.

Regular expiration and reactivation events use `(benefit_instance_id, notification_type)` as their logical key; digest events use `(user_id, notification_type, local eligibility date)`. First claim freezes recipient, subject, bodies, payload hash, and UUID idempotency key. Retryable/ambiguous outcomes reuse identical bytes/key at bounded intervals inside Resend's 24-hour window; leases prevent overlap and allow recovery after interruption. Slow provider calls are bounded. The UI calls provider acceptance “Sent” and does not claim inbox delivery without a webhook.

The expiration digest is one email per confirmed user and local calendar day, containing live,
incomplete benefits expiring today through seven days from today. Confirming a benefit as used
immediately removes it from future digest candidates.

## Standard card catalog and custom benefits

Accounts → Add account offers an exact, searchable catalog for selected U.S. consumer cards from
American Express, Chase, Capital One, U.S. Bank, Bank of America, and Citi. After choosing a card,
review the editable account details, then select the benefits to create. The catalog currently adds
Hilton Honors Aspire, Marriott Bonvoy Brilliant, United Explorer, Southwest Rapid Rewards Priority,
and Delta SkyMiles Reserve alongside the original catalog. Limited or contingent items are unchecked
by default. Every row links to the issuer source and shows its verification date; issuer terms always
control.

Renewal semantics are stored per benefit: explicit calendar-year/month/quarter benefits reset on
calendar boundaries, while benefits the issuer says arrive after card renewal use the account's
benefit-anniversary date. For an anniversary benefit, the form auto-fills that date from the annual-fee
renewal date and the server applies the same fallback atomically when only renewal_date is supplied.
The date is labeled as an estimate so it can be overridden when the issuer's benefit boundary differs
from the fee anniversary. If neither date is known, anniversary templates remain blocked; calendar
benefits do not require either date.

Provisioned items are normal benefits: edit, deactivate, redeem, and preserve their history exactly
like a manually entered benefit. An edit marks only that benefit customized; no later catalog
change overwrites it or its siblings. Existing accounts are not backfilled automatically.

The Custom choice works even if the catalog is unavailable. Accounts and Benefits both keep a
direct **Add custom benefit** path for side offers, targeted offers, shopping portals, rebates, or
cards not listed. A custom benefit can attach to either a catalog-created or custom account. Never
add the same shared benefit twice for primary and authorized-user cards without checking its terms.

Catalog facts older than 90 days show a warning; facts older than 180 days require explicit issuer
terms acknowledgement. Catalog updates are additive migrations. Apply backend migrations before
deploying a frontend that expects a newer catalog contract.

## Backup and restore

Use Settings → Export canonical JSON weekly on a hobby/free deployment and monthly at minimum on a backed-up plan. Encrypt the file, store it off-repository, and perform a quarterly restore drill. Canonical JSON is the only format that preserves definitions, periods, redemption history, and their relationships for a full restore.

For bulk setup, use Settings → Download CSV import template. Its `record_type` column accepts `account` and `definition`; stable `source_id` values identify rows, `account_source_id` links a definition to an account in the same file, and tags are pipe-delimited. The separate flattened account/definition/instance/redemption CSV exports are analysis files and are not round-trip import templates. CSV import validates quoting, fields, references, the 5 MiB/5,000-row limits, and recurrence/value combinations before calling the same atomic `import_backup` transaction. It creates usable periods through the recurrence engine but does not import historical periods or redemptions.

Both import paths provide a preview and support `skip` or `import_as_new` duplicate policy. Canonical
JSON schema v2 preserves benefit-anniversary dates, terms timezones, month-specific value rules, and
exact catalog provenance when the installed key/version/hash matches. Schema v1 remains accepted;
missing or mismatched catalog provenance degrades safely to custom/manual and produces a restore
warning. Catalog rows themselves are never exported. Imports default to `suppress_current`
notifications; `schedule_fresh` requires explicit acceptance of duplicate-email risk. One invalid
row or reference rolls back the complete import.

Exports contain personal notes. They are ignored by Git and must never be committed. CSV cells beginning with spreadsheet formula prefixes are neutralized before download; numeric negative values remain numeric.

`REVIEW.md` is the authoritative independent QA status. A requirements-matrix `PASS` records implementation evidence only and never replaces the required final Agent 4 `PASS`.

## Updating

1. Create a branch and run `npm ci`.
2. Add migrations instead of modifying an already deployed migration.
3. Run `npm run verify`, local database/Edge tests, and Playwright.
4. Review generated SQL, dependency changes, CSP impact, and secret scan output.
5. Merge or push to `main` and wait for CI to pass; CI includes a static backend-first release-order check, and CI alone never deploys Pages.
6. Run the protected **Deploy Backend** workflow for that exact `main` commit and project. Its success automatically triggers Pages for the same commit; failure or cancellation publishes nothing.
7. Confirm Pages smoke, scheduler heartbeat, and a health-only manual recovery call.

## Troubleshooting

- **Magic link fails:** confirm exact Site URL/redirect root including trailing slash, open it in the initiating browser, disable Resend link tracking, and request a fresh link if a scanner consumed it.
- **Unknown email cannot sign in:** this is expected. Create/confirm the owner in Supabase Auth; do not enable public signup.
- **Permission error:** confirm the session belongs to the row owner and that every migration/grant was applied. Do not work around RLS with a browser service key.
- **No reminder heartbeat for 36 hours:** unpause Supabase, inspect Cron/Edge logs and Vault names, verify all scheduler-secret copies match, call the protected health recovery, then process once.
- **Email retry/review:** inspect sanitized Edge and Resend logs. Never reset an attempted notification or mint a new idempotency key merely to retry.
- **Import rejected:** fix every preview/reference/type/date error. The database rolls back the complete import on one failure.
- **Pages assets 404:** set `VITE_BASE_PATH=/<REPOSITORY_NAME>/` and keep Auth redirects at the repository root; routing uses a hash after callback exchange.
- **Local npm cache permissions:** use a writable cache such as `npm ci --cache /private/tmp/perkledger-npm-cache`; do not use `sudo npm`.

## Cost and reliability profiles

Official prices checked August 19, 2026:

- [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) is available for public repositories on GitHub Free; private-repository Pages requires an eligible paid plan.
- [Supabase Free](https://supabase.com/pricing) is $0/month with 500 MB database storage and 500,000 Edge invocations, but has no automatic backups/SLA and may pause after one week of inactivity. Pro starts at $25/month and includes seven-day daily backups.
- [Resend Free](https://resend.com/pricing) is $0/month for 3,000 emails/month, 100/day, and one domain. Pro starts at $20/month.

For one owner's low-volume reminders, a public-source hobby deployment can therefore be $0/month if you already own a sender domain. Domain registration is a separate registrar charge. Keep encrypted exports even on a paid database plan, and verify all current prices/quotas at deployment because provider terms change.

See [DEPLOYMENT.md](DEPLOYMENT.md) for the exact sequential production checklist and every configuration value.
