# Credit Card Benefits, Reimbursements & Cashback Tracker — Final Candidate Plan v3

**Planning status:** FINAL — AGENT 1 AND AGENT 2 APPROVED  
**Agent 1 decision:** APPROVED  
**Agent 2 decision:** APPROVED  
**Implementation gate:** OPEN — Agent 3 is authorized to implement this approved plan.

`PLAN_RECONSIDERATION.md` records Agent 1's Round 1 and Round 2 disposition of every review comment. This file is the complete proposed plan; it does not rely on the reader applying amendment lists to prior drafts.

## 1. Product scope and principles

- Build a private, single-owner-first web app for credit-card/service accounts, benefit definitions, recurring period instances, redemptions, reminders, search/filtering, and portable backups.
- Represent fixed credits, percentage cashback with caps/minimum spend, memberships, points, portal offers, promotions, and complex free-text eligibility without issuer-specific code.
- Preserve historical periods and redemptions; recurring resets create instances and never overwrite prior usage.
- Run persistence, recurrence materialization, and email reminders without an open browser or powered-on user computer.
- Prefer a small, managed, low-maintenance architecture with GitHub as source and deployment control.
- Never collect full card numbers, CVVs, financial credentials, or transaction-login credentials.
- Store `user_id` ownership throughout even though v1 is deployed for one owner, allowing safe future extension.

## 2. Selected architecture

### Components

- **Frontend:** React, Vite, and strict TypeScript; static output hosted on GitHub Pages.
- **Routing:** React Router `HashRouter` for repository-path refresh safety; authentication uses PKCE query parameters before the hash router mounts.
- **UI:** plain responsive CSS/design tokens and small accessible components; no large component or state framework.
- **Backend:** one Supabase project providing managed PostgreSQL, Auth, RLS, Vault, Cron/`pg_cron`, `pg_net`, and a Deno/TypeScript Edge Function `process-notifications`.
- **Persistence:** normalized Postgres schema and transactional RPCs; browser access uses the publishable key plus authenticated JWT under deny-by-default RLS/grants.
- **Email:** Resend HTTP API from the Edge Function for benefit mail; a separate Resend SMTP credential in Supabase Auth settings for magic links.
- **Primary scheduler:** Supabase Cron, installed by migration after Vault bootstrap, invokes the Edge Function every 15 minutes at minutes 7, 22, 37, and 52.
- **Recovery trigger:** protected GitHub Actions `workflow_dispatch` invokes the same function manually; GitHub has no primary scheduled workflow.
- **Domain rules:** shared pure TypeScript for dates, recurrence, value, status, and validation where browser/Deno compatible; Postgres constraints/RPCs are authoritative and common fixtures prevent drift.

### Why static GitHub Pages is not the backend

GitHub Pages publishes static client assets. It cannot privately persist data, hold service/database secrets, enforce server validation, execute scheduled jobs, or send email. Supabase provides durable data, authentication, authorization, transactions, scheduled execution, and secret-backed server code; Resend provides mail delivery. The Pages bundle contains only browser-safe configuration.

### End-to-end flows

1. The browser loads repository-based static assets from Pages.
2. Supabase PKCE magic-link Auth establishes a user session before the hash router mounts.
3. The app reads owner rows through RLS views/tables and performs invariant-sensitive changes through narrowly granted transactional RPCs.
4. Supabase Cron calls the public Edge URL with `POST` and `X-Scheduler-Secret`, retrieving the high-entropy value from Supabase Vault.
5. The Edge Function authenticates the scheduler, computes each user's local date, generates missing instances, creates/claims due notification events, sends immutable payloads through Resend, and records independent outcomes.
6. A protected GitHub manual recovery workflow can make the same authenticated call after an operator checks scheduler health.
7. Database uniqueness, exclusion constraints, row locks, immutable payloads, and provider idempotency make overlapping/repeated invocations safe.

## 3. Alternatives and tradeoffs considered

| Option                            | Decision                                                                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Firebase Auth/Firestore/Functions | Viable but rejected: relational history, range constraints, reporting, and atomic notification claims are clearer in Postgres.                 |
| Vercel/Netlify full-stack         | Viable but rejected for v1: another runtime/deployment surface is unnecessary with one Supabase function.                                      |
| GitHub Actions cron               | Recovery only: scheduled runs can be delayed/dropped or inactivity-disabled, so it is not the unattended primary clock.                        |
| Supabase Cron + Vault             | Selected: scheduler resides with the existing backend, is migration-defined, secret-backed, observable, and low maintenance.                   |
| GitHub Actions as processor       | Rejected: it would expose broader database credentials to another runtime and duplicate backend logic.                                         |
| Browser timers/localStorage       | Rejected for data/jobs: neither is secure, durable, cross-device, nor operational offline. Non-sensitive UI preferences may use local storage. |
| Custom Node server                | Rejected: adds hosting/patching/availability work without a product benefit.                                                                   |

This remains three managed surfaces—GitHub, Supabase, and Resend—with one application backend. The revision/instance model and server RPCs are justified complexity needed for history and invariants.

## 4. Authentication and session design

### Owner bootstrap

1. Create or invite the one owner from Supabase Dashboard → Authentication → Users.
2. Require confirmed email; disable anonymous sign-in and “Allow new users to sign up.”
3. The client calls `signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo } })`; unknown addresses cannot create accounts.
4. Recovery/admin access uses the Supabase Dashboard owner account; the README documents re-enabling access without changing application code.

### PKCE with GitHub Pages

- Configure the Supabase browser client with `flowType: 'pkce'`.
- Production Site URL and allowlisted redirect: `https://<GITHUB_OWNER>.github.io/<REPOSITORY_NAME>/`.
- Local allowlisted redirect: `http://localhost:5173/` (and only specifically documented test ports).
- Magic-link `emailRedirectTo` is the repository root, not a hash path.
- Startup checks `?code=...`, calls `exchangeCodeForSession` before mounting `HashRouter`, removes the code/error query with `history.replaceState`, then navigates to `#/dashboard`.
- PKCE magic links must be opened in the browser/device that initiated sign-in because the verifier is stored there; UI and troubleshooting state this explicitly.

### Auth email

- Configure Resend custom SMTP in Supabase Auth with a separate sending credential and verified `auth@<OWNED_DOMAIN>` sender.
- SMTP host/port/user/password live only in Supabase Auth settings, not Edge secrets, GitHub, `.env`, or client code.
- Disable link tracking for authentication messages; documentation warns that corporate link scanners may consume one-time links and provides resend/retry guidance.
- Benefit-mail API credentials and Auth SMTP credentials are distinct and independently rotatable.

### Browser/XSS threat model

- A static SPA persists a refresh token in browser storage; RLS limits data access but a successful same-origin XSS could act as the user.
- Never use raw HTML or `dangerouslySetInnerHTML`; render descriptions/notes as text, validate URLs, and avoid runtime third-party scripts.
- Include a restrictive Pages-compatible meta CSP allowing only self assets and the exact Supabase API connection; avoid inline script and minimize unavoidable inline style.
- Pin dependencies/lockfile, run Dependabot and dependency review, revoke compromised sessions in Supabase, and provide obvious logout/shared-device guidance.
- Session expiration/revocation behavior is documented; secrets, tokens, email bodies, and private notes are excluded from logs.

## 5. Database model and invariants

All IDs are UUIDs; audit timestamps are `timestamptz`; user-facing period/deadline/redemption dates are Postgres `date`. V1 fiat values are `numeric(14,2)` and explicitly limited to at most two fractional digits. Every owner-child relationship uses a composite foreign key including `user_id` backed by a matching unique key.

### `profiles`

- `user_id` PK/FK to `auth.users`, copied email, optional notification email, IANA timezone default `America/New_York`, reminder toggles default true, `recent_reset_days` 0–30.
- Only `update_profile_settings` may change timezone/notification settings; it validates timezone server-side against `pg_timezone_names`.

### `accounts`

- `id`, `user_id`, display name, issuer/provider, card/service name, optional nickname and four-digit `last_four`, annual fee and `annual_fee_currency`, renewal date, notes, active flag.
- Checks reject malformed last four, negative fees, unsupported two-decimal currency input, and credential-like fields are absent.
- Referenced accounts deactivate rather than delete; unreferenced accounts may be deleted after confirmation.

### `benefit_definitions`

- Ownership/identity: `id`, `user_id`, optional account, name, category, description, notes, active and recurrence-enabled flags.
- Value: `value_kind` (`money`, `percentage_cashback`, `points`, `membership`, `other`), amount, currency, unit label, minimum spend, cashback percentage, and optional issuer cashback cap; null cap explicitly means uncapped.
- Eligibility: merchant, merchant category, website, tags, and unrestricted plain-text eligibility notes.
- Enrollment: `enrollment_required`, optional deadline, optional `enrolled_at`.
- Date/recurrence: effective/end dates, recurrence type/basis, reset/anchor fields, interval months, and current revision number.
- Per-definition expiration/reactivation email toggles default true.

### `benefit_definition_revisions`

- Definition/user IDs, monotonic revision number, immutable `valid_from`, nullable closure metadata `valid_to`, and normalized authoritative value/eligibility/date/recurrence columns.
- A generated immutable JSON business snapshot supports audit/export, excludes `valid_to`, and is never an independently writable source of truth.
- Unique `(definition_id, revision_no)`, a partial unique index where `valid_to IS NULL`, and a GiST exclusion constraint reject multiple open or overlapping revision ranges.
- Business/snapshot fields never change. The sole permitted update is one privileged `valid_to: NULL → successor.valid_from - 1 day` transition performed under a definition lock by the lifecycle RPC; closed revisions cannot reopen or close again.

### `benefit_instances`

- Definition/revision/user IDs, deterministic `occurrence_key`, positive `instance_version`, optional `supersedes_instance_id` on the replacement version, recurrence sequence, unclipped nominal boundaries, displayed/eligible period dates, nullable available quantity, currency/unit, label, generated source/time, reactivation eligibility, manual completion fields, and void time/reason.
- Absolute unique `(definition_id, occurrence_key, instance_version)` preserves audit versions. Partial unique `(definition_id, occurrence_key) WHERE void_time IS NULL` permits exactly one live version.
- A partial GiST exclusion constraint on inclusive `daterange(period_start, period_end, '[]')` per definition rejects overlap among non-void instances.
- Local checks enforce ordered dates, valid units/currency, positive versions, and nonnegative finite availability. Availability is null only for uncapped percentage cashback; it is not a cross-table `CHECK` against redemptions.
- A `security_invoker` aggregate view derives redemption sum, nullable remaining quantity, earned-to-date, independent statuses, and attention flags.

### `redemptions`

- Instance/user IDs, positive redeemed benefit quantity, used date, optional merchant, transaction description, and notes.
- For cashback, amount means cashback/statement-credit value earned—not gross purchase spend. Gross spend may appear only in optional notes.
- Points are whole-unit quantities. Membership/other benefits use explicit count/unit quantities; a binary benefit is quantity 1.
- For finite benefits, RPCs lock the instance and reject aggregate redemption above availability. Uncapped cashback accepts any positive earned amount and has no fabricated upper bound.
- Remaining is derived for finite benefits and null/“Uncapped” otherwise; it is never stored independently.

### `notifications`

- Instance/user IDs, type (`expiration_7_day`, `reactivation`), mutable `scheduled_for`, event eligibility timestamps, and unique `(benefit_instance_id, notification_type)`.
- State: `pending`, `processing`, `provider_accepted`, `definitive_failed`, `retryable_failed`, `ambiguous`, `skipped`, `superseded`, or `requires_review`; supersession stores replacement instance/notification links.
- First attempt atomically freezes recipient, subject, rendered text/HTML body, payload JSON, payload SHA-256, notification UUID idempotency key, and `first_attempt_at`.
- Attempts store count, claim/lease time, next-attempt time, last sanitized error/category, provider message ID, accepted time, and optional delivery state (`unknown`, `delivered`, `bounced`, `complained`) for future webhook support.
- V1 “Sent” in UI means provider accepted; it does not claim final inbox delivery without a delivery webhook.

### Private operational tables

- `private.job_runs` stores trigger, start/end, heartbeat, user-local processing date range, counts, status, and sanitized error.
- Optional `private.notification_attempts` records timing/outcome without sensitive payload/body duplication.
- These tables have no Data API grants. A narrow read RPC exposes only the owner's last-success time and aggregate health.

### Database-level ownership and immutability

- Enable `btree_gist`; use same-owner composite foreign keys for account→definition and definition→revision→instance→redemption/notification.
- Ownership IDs, occurrence/version identity, revision business snapshots, frozen notification fields, and provider acceptance cannot be directly changed by browser roles.
- Revision triggers reject every mutation except the lock-scoped one-time `valid_to` close transition; deferred validation requires an immediately adjacent successor and one open non-overlapping revision at commit.
- Finite availability-versus-redemption is enforced by locked RPC aggregation and a deferred cross-table constraint trigger for privileged/import writes—not by a simple row `CHECK`.
- Other triggers reject attempted-notification payload mutation and timestamps inconsistent with state transitions.
- Hard delete is limited to unreferenced drafts. Normal lifecycle uses account/definition deactivation, recurrence disablement, or instance voiding with reason.

## 6. Grants, RLS, views, and RPC contract

RLS is enabled and forced where appropriate. `anon` receives no table/RPC access beyond Supabase Auth itself. The publishable key is safe to expose only because it has no privileged grant and every read is authenticated/RLS-scoped.

| Object                         | Authenticated direct select              | Direct insert/update/delete                         | Authorized mutation path       |
| ------------------------------ | ---------------------------------------- | --------------------------------------------------- | ------------------------------ |
| `profiles`                     | Own row                                  | None                                                | `update_profile_settings`      |
| `accounts`                     | Own rows                                 | Own rows under RLS/checks; delete only unreferenced | Direct simple CRUD             |
| `benefit_definitions`          | Own rows                                 | None                                                | benefit lifecycle RPCs         |
| `benefit_definition_revisions` | Own rows                                 | None                                                | benefit lifecycle RPCs         |
| `benefit_instances`            | Own rows/view                            | None                                                | generation/edit/override RPCs  |
| `redemptions`                  | Own rows                                 | None                                                | redemption RPCs                |
| `notifications`                | Own rows                                 | None                                                | server notification RPCs only  |
| aggregate views                | Own rows through `security_invoker=true` | None                                                | N/A                            |
| `private.*`                    | None                                     | None                                                | service role/private functions |

Client-callable transactional RPCs are narrowly typed: `create_benefit`, `edit_benefit`, `set_recurrence_enabled`, `set_benefit_active`, `override_instance`, `record_redemption`, `edit_redemption`, `delete_redemption`, `mark_uncapped_complete`, `update_profile_settings`, `import_backup`, and `scheduler_health`.

- Each `SECURITY DEFINER` RPC sets `search_path = ''`, fully qualifies every object, verifies `auth.uid()` and same-owner relationships, and validates inputs independently of the client.
- Revoke function execution from `public` and `anon`; grant only exact intended signatures to `authenticated`. Server-only claim/generation/state-transition RPCs are service-role-only.
- Functions set/derive `user_id`; they never trust caller/import ownership IDs.
- Aggregate views explicitly set `security_invoker=true` on supported Postgres versions or remain in a non-exposed schema behind a read RPC.
- Database/RLS tests enumerate every operation in the matrix, including column tampering and cross-owner relationships.

## 7. Values, balances, statuses, and summaries

- Monetary values are two-decimal fiat values with an uppercase ISO-style currency code; v1 does not claim support for three-decimal minor-unit currencies.
- Dashboard monetary totals group by currency (`USD`, `EUR`, etc.) and never invent FX conversion. Points, memberships, and other units appear in separate summaries.
- Capped percentage cashback stores finite instance availability equal to the official cap. Redemption records benefit earned; remaining cap is labeled “potential remaining cashback,” not guaranteed value.
- Uncapped percentage cashback stores null availability/remaining, displays “Uncapped,” tracks earned-to-date through redemptions, and is excluded from finite Available Value totals. A separate summary count reports active uncapped offers; no FX or artificial tracking ceiling is invented.
- `lifecycle_status` is independently derived as `upcoming`, `active`, `expired`, or `void`.
- Finite `usage_status` is unused at zero, partial below availability, and used at availability. Uncapped usage is unused before any redemption, partial after one or more redemptions, and used only when `mark_uncapped_complete` records explicit completion.
- Attention flags are separate booleans: expiring in 7 days, expiring in 30 days, recently activated, reset soon, enrollment due, and scheduler unhealthy.
- Exact requested labels map without losing either axis: Upcoming = upcoming; Available = active + unused; Partially Used = active + partial; Used = any non-void lifecycle + used; Expiring Soon = active with finite remainder or incomplete uncapped status and 0–7 days; Expired = expired, composed with usage where useful.
- UI may display composites such as “Expiring Soon · Partially Used” or “Expired · Used”; filters expose lifecycle and usage separately.
- Days remaining is calendar-day difference to inclusive `period_end`: 0 on expiration date and negative afterward.

## 8. Recurrence and timezone rules

### Explicit timezone policy

- Period boundaries and deadlines are ISO date-only values. Never parse them through implicit browser/UTC midnight.
- `@js-temporal/polyfill` supplies local date/calendar arithmetic using the stored IANA timezone, default `America/New_York`.
- `update_profile_settings` accepts a timezone only if it exists in server `pg_timezone_names`.
- Changing timezone never shifts existing date-only periods/redemptions. It changes local “today,” future generation/attention, and unattempted notification eligibility; attempted immutable payloads remain unchanged. The UI previews/warns and tests DST/cross-zone boundaries.

### Supported periods

- Calendar monthly: first through last day of each calendar month.
- Calendar quarterly: Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec.
- Calendar semiannual: Jan–Jun and Jul–Dec.
- Calendar annual: Jan–Dec.
- Anniversary recurrence: each period begins at original anchor plus `sequence × interval_months` and ends one day before the next; never derive from the previous clipped date.
- Custom v1 recurrence means every positive N calendar months from an anchor. Arbitrary day/week recurrence is intentionally out of scope because benefit periods require calendar-safe boundaries.

### Reset fields and edge arithmetic

- The form's optional Reset Date maps explicitly: calendar recurrence stores calendar basis/period; anniversary/custom stores original `anchor_date` plus interval months. One-time benefits may store a display-only reset date only by converting to a recurrence choice.
- End-of-month anchor uses last-valid-day semantics without drift (August 31 → September 30 → October 31 by original-anchor sequence).
- February 29 annual anchor uses February 28 in non-leap years and returns to February 29 in leap years.
- Effective/end dates clip eligible displayed boundaries but do not alter nominal boundaries, sequence, or `occurrence_key`.
- `occurrence_key` is deterministic from basis + original anchor/calendar bucket + sequence, not from mutable displayed dates.

### Materialization and backfill

- `create_benefit` immediately creates the one-time instance or the recurring current instance and first future occurrence (even beyond 31 days), plus any other occurrence beginning within 31 days; Upcoming therefore works without waiting for Cron.
- Normal creation with an old effective date does not silently generate years of empty history. Default starts at the current occurrence; an explicit confirmed backfill may create at most 24 months per request.
- Canonical backup restore may restore validated historical periods within import limits; imported/backfilled/current-at-creation instances set `reactivation_eligible=false`.
- Server processing fills missing sequences from the last stored occurrence through today +31 days, in bounded 24-month batches and resumable transactions. Ended backfill periods never send reactivation mail.
- A genuinely future occurrence produced after creation has `reactivation_eligible=true` and becomes mail-eligible only on its local start date.
- Definition end date stops later occurrences and clips only the final applicable period; effective date similarly clips the first.

## 9. Atomic create, edit, disable, and redemption semantics

### Creation

- `create_benefit` validates account ownership/value/dates/recurrence, then atomically inserts definition, revision 1, and immediately relevant instance(s).
- A failure rolls back everything; exact RPC response returns new definition/current instance IDs.

### Editing a recurring definition

- The dialog requires explicit scope: **future periods** (default), **current and future**, or **this period only**.
- Future-period edit locks the definition, begins at a selected valid occurrence boundary, performs the sole allowed close of the open revision to one day before that boundary, inserts the successor revision, and reconciles eligible future instances in one transaction.
- A deferred constraint verifies adjacent/non-overlapping ranges and exactly one open revision at commit. Concurrent edits serialize on the definition lock; direct callers cannot close, reopen, or edit revision rows.
- Current-and-future edit creates a current-boundary revision. If current has redemptions or any notification attempt, protected value/boundary fields do not silently change: the RPC rejects them and offers future-only plus a separate explicit instance override.
- This-period-only uses `override_instance`; it retains definition/revision history, occurrence key, nominal start, and audit reason. Availability cannot fall below redeemed value, and range changes cannot overlap another live instance.
- Description/eligibility metadata can be revisioned without rewriting old snapshots. “All historical periods” is unsupported in v1.

### Pre-generated instance reconciliation

- Regeneration is allowed only for unstarted instances with no redemption and no notification attempt. The RPC locks the definition/live rows, voids the old version for audit, and inserts the replacement in the same transaction.
- A value-only edit with unchanged period retains `occurrence_key` and increments `instance_version`; an anchor-changing revision derives its new key from the new anchor/sequence. Partial live-key uniqueness plus live-range exclusion prevents two live versions or overlaps.
- Used, started, attempted, accepted, expired, or historical instances remain unchanged. A conflicting material edit is rejected with a specific UI explanation.
- An unattempted notification attached to a voided version becomes `superseded`, links to the replacement, and cannot send. The new live instance gets its own event when eligible; accepted/ambiguous attempts are never eligible for regeneration or erased.

### Disablement/deactivation

- `set_recurrence_enabled(false)` preserves the current and all historical instances, voids unstarted unused/unattempted future instances, and prevents later generation.
- Re-enabling starts at the next genuine boundary and does not backfill disabled periods unless explicitly requested; it never emits “available again” for the act of re-enabling itself.
- `set_benefit_active(false)` suppresses dashboard action/reminders and marks pending unattempted notifications skipped; instances/history remain inspectable.
- Reactivation reuses eligible current occurrence and the same logical notification event if never attempted; it never creates a second accepted event.

### Redemptions

- Record/edit/delete RPCs lock the instance, enforce positive value and currency/unit compatibility, and reject aggregate over-redemption only when availability is finite; a deferred cross-table trigger validates privileged/import transactions before commit.
- “Mark Used” inserts exactly the finite calculated remainder. Uncapped cashback instead exposes “Mark Complete,” whose RPC locks the live instance and sets immutable completion time/note without inventing a redemption or cap.
- Multiple partial redemptions remain independent history rows. Editing/deleting recalculates totals; no stored remaining balance can drift.

## 10. Reminder event selection and idempotent delivery

### Invocation contract

- Set `[functions.process-notifications] verify_jwt = false` in `supabase/config.toml`; this exception applies only to this scheduler endpoint.
- Accept only `POST`; reject `OPTIONS`, browser JWT alone, missing/wrong secret, and every other method with a generic response.
- Require `X-Scheduler-Secret`, compare its high-entropy value in constant time, expose no CORS headers, rate-limit/bound work, and log no credential.
- The URL is public by necessity but unusable without the secret. Required tests cover missing, wrong, user-JWT-only, valid, method, and CORS cases.
- The signed POST body selects `mode: "process"` or a non-mutating `mode: "health"`; health verifies function/database readiness without selecting or sending notifications and returns only minimal status.

### Selection rules

- Expiration target is `period_end - 7 calendar days` in the profile timezone. Select every unsent event with target <= local today while the instance is active, not void, reminders are enabled, today <= period end, and either finite remainder is positive or uncapped cashback is not manually complete.
- A benefit entered/edited with only 0–6 days remaining queues the same expiration event on the next run. An overdue event catches up for any duration until expiration; it is skipped after expiration or clear ineligibility.
- Reactivation event is eligible only when local today >= period start, the occurrence was genuinely generated ahead, reactivation is enabled, and finite value remains or uncapped cashback is incomplete. Pre-generation never sends early.
- Creation, canonical restore, manual backfill, recurrence re-enable, and already-ended catch-up do not generate reactivation email.
- Preferences default on. Turning them off skips pending unattempted work; turning on can revive the same never-attempted logical event only while eligible.
- Deactivation behaves likewise. Finite full usage or explicit uncapped completion skips expiration; deleting/editing a redemption after the due date revives the same never-attempted finite event if still active, but never resends an attempted/accepted event.
- Editing expiration reschedules the same unattempted row. Once first attempt freezes payload, later date edits do not mutate it or create a second logical email.

### Transactional processing

1. Authenticate the scheduler request and create `private.job_runs` heartbeat state.
2. Resolve each user's local date and generate bounded missing occurrences using deterministic keys/exclusion constraints.
3. Insert logical candidates with `ON CONFLICT (benefit_instance_id, notification_type) DO NOTHING`; update only eligible never-attempted schedule data.
4. Claim batches through a service-only RPC using `FOR UPDATE SKIP LOCKED`, leases, and state preconditions.
5. Recheck definition, preferences, lifecycle, finite remainder or uncapped completion, and supersession state. Skip ineligible events without mutating benefit/redemption history.
6. On first attempt, freeze recipient/subject/body/payload/hash/idempotency UUID atomically before external I/O.
7. Submit byte-identical payload to Resend with mandatory `Idempotency-Key: <notification_uuid>`.
8. Record provider acceptance/message ID, definitive rejection, retryable rejection, or ambiguous transport result; one failure does not abort other events.
9. Refresh run heartbeat between batches and finish with sanitized counts/status.

### Retry and crash ambiguity

- Retry only retryable 429/5xx and ambiguous timeout/connection outcomes; do not retry definitive 4xx validation/rejection.
- Use the same frozen payload/key at approximately 15 minutes, 1 hour, 4 hours, 12 hours, and 23 hours from first attempt, subject to provider responses.
- A crash after provider acceptance leaves a leased row; after 15 minutes, recovery resubmits the same key within Resend's 24-hour idempotency retention so the provider deduplicates.
- If an ambiguous/stale event reaches 24 hours after first attempt unresolved, set `requires_review` and never automatically submit it again or invent a new key.
- Any still-retryable event also stops automatic attempts at 24 hours and becomes `requires_review`; known definitive rejection remains `definitive_failed`.
- Manual review may mark provider evidence as accepted or deliberately create a separately confirmed manual send; the default favors no duplicate.
- Tests simulate concurrent jobs, crash after provider acceptance, immutable payload, retry at hour 23, and suppression at/after hour 24.

### Email contents and health

- Expiration subject/body include benefit, account/provider, expiration date, days remaining, and relevant notes. Finite benefits show remaining quantity/value; uncapped cashback shows “Uncapped” plus earned-to-date.
- Reactivation includes benefit, account/provider, new amount/unit, new period, and expiration date.
- Settings shows last successful run, last outcome, next expected run, and failed/review count. Dashboard shows a non-dismissable stale warning after 36 hours without success.
- Recovery runbook: inspect Cron/job/function health, correct pause/secret/provider problems, use protected GitHub manual dispatch, confirm new heartbeat, then inspect overdue/review events.

## 11. Dashboard and UX

- Responsive summary cards show finite available value by currency, active uncapped-offer count, expiring in 7/30 days, used this month by currency/unit, and unused count; points/non-money are separate.
- Needs Attention prioritizes scheduler unhealthy, enrollment required within 7 days, finite remaining value or incomplete uncapped offers expiring within 7 days, enrollment/expiration within 30 days, newly active, reset soon, then upcoming.
- Main desktop table/mobile cards show benefit, account/provider, category, finite total/remaining or “Uncapped” with earned-to-date, effective/period dates, recurrence, lifecycle, usage, flags, and days remaining.
- Search covers benefit/account/provider/merchant/category/notes; filters cover account, issuer/provider, category, lifecycle, usage, recurrence, expiration bucket, enrollment, merchant, and active state.
- Forms progressively reveal fixed/cashback/unit, eligibility, enrollment, and recurrence/reset fields and explain the two-decimal/custom-month limitations.
- Primary actions are visible: Add Benefit, Record Usage, Edit, Mark Used (finite), Mark Complete (uncapped), Mark Enrolled, Filter, View Upcoming, Import, Export.
- Loading, empty, validation, offline, permission, conflict, and server failure states preserve entered form data and give safe recovery steps.
- Accessibility uses semantic labels/tables, keyboard operation, visible focus, adequate contrast, non-color status cues, reduced motion, and target sizes suitable for touch.

## 12. Import, export, backup, and restore

- Canonical versioned JSON exports accounts, definitions/revisions, instances, and redemptions; notification metadata may be audit-only and is never restorable authority.
- Separate flattened CSVs export accounts, definitions, instances, and redemptions for analysis. CSV import accepts accounts/definitions only.
- Client Zod validation produces a preview and full error list, but is advisory.
- `import_backup(jsonb, duplicate_policy, current_notification_policy)` independently validates schema version, maximum 5 MiB payload, maximum 5,000 rows, types, lengths, dates, recurrence/value/cap combinations, two-decimal currencies, references, duplicate policy, and notification policy.
- The RPC ignores incoming `user_id`, notification states, operational state, and trusted timestamps; generates new IDs; maps old references in-memory/temp tables; and applies all writes in one transaction.
- Canonical restore recreates validated history/redemptions but never notification authority; restored current/history instances have reactivation suppressed. Default `suppress_current` also suppresses their expiration events to avoid unknown duplicate sends.
- Optional explicit `schedule_fresh` warns that pre-restore provider sends cannot be deduplicated and authorizes one new expiration event for each eligible unexpired/incomplete current instance, scheduled by the normal seven-day target/catch-up rules rather than immediately unless already due. Genuine future occurrences generated after restore follow normal notification rules. CSV creates definitions/current instances through the normal creation path.
- Duplicate policy is explicitly `skip` or `import_as_new`; v1 never overwrites existing live history from an import.
- Any validation/reference/constraint error rolls back the entire import. Import limits prevent excessive database/function work.
- README mandates encrypted off-repository backups and a documented restore drill; exports must never be committed to the source repository.

## 13. Dependencies and repository structure

### Dependencies

- Runtime: `react`, `react-dom`, `react-router-dom`, `@supabase/supabase-js`, `@js-temporal/polyfill`, and `zod`.
- Development: Vite, TypeScript, ESLint, Prettier, Vitest, React Testing Library, `user-event`, MSW, Playwright, and an axe accessibility integration.
- Edge: Supabase/Deno client, shared domain/validation modules, and a small typed Resend `fetch` adapter that can be replaced by a fake transport.
- No date-picker, state manager, component framework, or Resend SDK unless implementation evidence justifies it.
- Commit exact lockfile. Use Dependabot only; pin GitHub Actions to immutable commit SHAs with version comments and review all updates.

### Repository structure

```text
credit-card-benefits-tracker/
├── .github/{workflows,dependabot.yml}/
│   └── workflows/{ci,deploy-pages,deploy-backend,manual-notification-recovery}.yml
├── src/{components,features,pages,hooks,domain,services,test}/
├── e2e/  public/  scripts/
├── supabase/
│   ├── migrations/  tests/  seed.sql  config.toml
│   └── functions/{process-notifications,_shared}/
├── .env.example  .gitignore  package.json  package-lock.json
├── index.html  tsconfig.json  vite.config.ts  playwright.config.ts
└── PLAN.md  PLAN_REVIEW.md  PLAN_RECONSIDERATION.md
    README.md  DEPLOYMENT.md  REQUIREMENTS.md  REVIEW.md
```

## 14. Secrets and configuration matrix

| Name/value                       | Where obtained                             | Where entered                                                       | Browser-safe? / scope                               |
| -------------------------------- | ------------------------------------------ | ------------------------------------------------------------------- | --------------------------------------------------- |
| `VITE_SUPABASE_URL`              | Supabase Project Settings → API            | local `.env.local`; GitHub Pages environment variable               | Yes; project URL                                    |
| `VITE_SUPABASE_PUBLISHABLE_KEY`  | Supabase Project Settings → API            | local `.env.local`; GitHub Pages environment variable               | Yes only with tested RLS/grants                     |
| `VITE_APP_BASE_URL`              | final Pages URL                            | local/GitHub environment variable                                   | Yes; non-secret redirect config                     |
| `RESEND_API_KEY`                 | Resend API Keys, benefit-send-only key     | Supabase Edge Function secret                                       | **No**; benefit email only                          |
| `RESEND_FROM_EMAIL`              | verified owned Resend domain               | Supabase Edge Function secret/config                                | Not sensitive alone; server only                    |
| `SCHEDULER_SECRET`               | generate ≥32 random bytes locally          | same value in Edge secret, Supabase Vault, GitHub production secret | **No**; rotate all three copies together            |
| `PROCESS_NOTIFICATIONS_URL`      | deployed Supabase function URL             | Supabase Vault and GitHub environment variable                      | URL is non-secret; endpoint still protected         |
| `SUPABASE_ACCESS_TOKEN`          | Supabase Account → Access Tokens           | GitHub protected production secret                                  | **No**; CLI deploy scope, rotate/revoke at Supabase |
| `SUPABASE_PROJECT_REF`           | Supabase project URL/settings              | GitHub protected environment variable                               | Identifier is non-secret                            |
| `SUPABASE_DB_PASSWORD`           | chosen/reset in Supabase database settings | GitHub protected production secret                                  | **No**; migration connection only                   |
| Auth SMTP host/port/user         | Resend SMTP settings                       | Supabase Auth → SMTP                                                | Host metadata not sensitive; service-only           |
| Auth SMTP password               | separate Resend SMTP credential            | Supabase Auth → SMTP only                                           | **No**; never GitHub/Edge/client                    |
| Edge `SUPABASE_URL`/service role | Supabase function runtime-provided         | managed function environment                                        | **No** service role; never browser/GitHub build     |

- `.env.example` contains names/placeholders and browser-safety comments only; `.env*` except the example is ignored.
- Supabase Vault values are created during protected bootstrap, never committed in a migration. Cron migration resolves named Vault entries.
- GitHub environment reviewers protect backend deployment/recovery secrets. Fork PRs receive no production secrets.
- Rotation runbooks cover scheduler, deploy token/password, benefit API, and SMTP separately; secret scans run in CI.

## 15. GitHub CI and deployment architecture

### `ci.yml` — mandatory on every PR/push

- Use pinned actions, pinned Node/Supabase CLI versions, `npm ci`, dependency audit policy, lint, formatting check, strict typecheck, and production build.
- Start deterministic local Supabase with Docker, reset/apply every migration, load fixtures, and run SQL database/constraint/RLS/grant/RPC tests.
- Serve the Edge Function locally with a fake Resend transport and run authorization, selection, claim, retry/crash, payload, and failure-isolation integration tests.
- Run Vitest/component tests and Playwright auth/UI E2E using local Supabase Inbucket or deterministic fixture—never production credentials.
- Core integration/E2E checks are not conditional. CI fails if local infrastructure or any required test fails.

### `deploy-pages.yml`

- After protected `main` CI succeeds, build with Vite `base: '/<REPOSITORY_NAME>/'`, upload `dist`, and deploy using official Pages actions pinned to commits and minimal Pages/id-token permissions.
- Build receives only browser-safe `VITE_*` values. Hash routing handles nested application routes; PKCE callback uses the repository root query.
- Production smoke checks asset URLs, login request/callback, auth guard, database read, and responsive dashboard at the final repository URL.

### `deploy-backend.yml`

- Protected `workflow_dispatch` (or approved tagged release) targets a GitHub `production` environment with required human approval.
- Pin Supabase CLI; validate migrations/diff, link the exact project, apply migrations, deploy `process-notifications`, and fail before frontend release if backend compatibility breaks.
- Use `SUPABASE_ACCESS_TOKEN`, project ref, and database password only at runtime; no Resend/Auth SMTP secrets enter GitHub.
- Post-deploy smoke tests wrong/valid scheduler authentication without sending a real user email, verifies Cron registration/Vault reference, and records the deployed migration/function revision.

### `manual-notification-recovery.yml`

- `workflow_dispatch` only, production approval, minimal permissions, concurrency lock, timeout, and `POST` with `X-Scheduler-Secret`.
- It is an operator recovery mechanism, not a scheduled workflow; database claims/idempotency remain authoritative.

## 16. Deployment sequence

1. Create a GitHub repository, decide public-source/free Pages or private-source/paid Pages, push reviewed files, and protect `main`/`production` environment.
2. Create a Supabase project in the desired region and record URL, publishable key, project ref, database password, and a scoped account access token.
3. Generate `SCHEDULER_SECRET`; create named Vault entries for it and the function URL, set the same Edge secret, and later add it to GitHub production secrets.
4. Run the protected backend workflow to validate/apply schema, install Cron, and deploy the function; verify unauthorized/authorized dry-run calls.
5. Acquire/control a sender domain, configure DNS in Resend, wait for verification, and create distinct benefit API and Auth SMTP credentials.
6. Put benefit API/from values in Edge secrets and SMTP values only in Supabase Auth; disable Auth link tracking before sending any invitation.
7. Create or invite the owner in Supabase Auth; require confirmed email and disable new/anonymous signup. An invitation may be sent only after step 6.
8. Configure exact production/local Auth Site/Redirect URLs for the Pages repository root.
9. Add GitHub variables/secrets from Section 14, enable Pages through Actions, run CI, backend deploy, then Pages deploy.
10. Validate production PKCE in the initiating browser, owner-only access, CRUD/RPC isolation, refresh/redeploy persistence, and logout/revocation.
11. Send a controlled test benefit email; confirm UI means provider accepted and inspect Resend outcome.
12. Create test monthly/quarterly/anniversary benefits, a partial redemption, an expiration within seven days, and enrollment deadline.
13. Invoke recovery twice concurrently; verify one instance/event/email, correct immutable payload, and run heartbeat.
14. Confirm the dashboard health indicator, Cron next run, overdue catch-up, failed/review visibility, export, encrypted backup, and restore drill.

The final README/DEPLOYMENT checklist must repeat every variable with obtain/enter/browser-safety instructions rather than saying only “configure environment variables.”

## 17. Test strategy and release gates

### Pure domain tests

- Dates: February, leap years, 28/29/30/31-day months, inclusive expiration, December→January, DST boundaries, timezone change, and non-browser timezone.
- Recurrence: all calendar types, original-anchor anniversary, N-month custom, end-of-month, leap day, effective/end clipping, deterministic occurrence key, bounded backfill, disable/re-enable.
- Values: fixed/capped and uncapped percentage/minimum spend, multiple earned-cashback redemptions, explicit uncapped completion, two-decimal rejection, currency grouping/no FX, points and binary/count units.
- Status: every lifecycle × finite/uncapped usage combination plus expiration/reset/enrollment/health flags.

### Database/RPC integration tests

- Benefit create/edit scopes/deactivate/delete-draft, initial instance, future reconciliation, current protected edit, instance override, redemption create/edit/delete/mark-used, and overuse/lower-below-used rejection.
- One-time revision close, ordinary close/reopen denial, concurrent one-open revision, closed-range exclusion, versioned occurrence partial-live uniqueness/range exclusion, same-owner FKs, immutable snapshots, import limits/rollback/ID mapping.
- Future value-only same-key regeneration, anchor-change regeneration, retained void audit versions, notification supersession, concurrent regeneration, and proof that two live versions cannot exist.
- Two authenticated owners, anonymous, and compromised-client attempts cover every matrix cell, spoofed ownership, immutable columns, views, and server-only functions.
- Concurrent generation/edit/redemption claims prove one occurrence, correct totals, and no lost update.

### Notification/Edge integration tests

- Missing/wrong scheduler secret, user JWT only, wrong method, no CORS, valid secret, bounded work, and sanitized logs.
- Exactly-seven-day, late 0–6-day, long-overdue active, expired, finite full/partial/unused, uncapped unused/earned/completed, deleted redemption, preferences, deactivate/reactivate, early pre-generation, backfill and restore-policy suppression.
- Expiration edit before attempt reschedules same row; after attempt keeps immutable single event.
- Duplicate/concurrent schedules, failed email isolation, definitive/retryable/ambiguous outcomes, lease recovery, crash-after-acceptance, identical payload/hash/key, 23-hour retry, and ≥24-hour `requires_review`.
- Monthly/quarterly/annual reactivation content and new-period local start behavior.

### UI/E2E/accessibility tests

- PKCE exchange before `HashRouter`, same-browser guidance, exact Pages base path, auth guard, session/logout, owner bootstrap failure for unknown email.
- Responsive dashboard/search/sort/filter—including capped/uncapped and completion—at 320px, 768px, and 1280px; Add/Edit/Record/Mark Used/Mark Complete/Mark Enrolled flows and protected-history confirmations.
- JSON/CSV export, valid preview/import, malformed/cross-reference/oversize rollback, backup restore round-trip, and `suppress_current`/warned `schedule_fresh` behavior.
- Automated axe checks plus manual keyboard, representative screen-reader, contrast, touch target, and non-color verification; `prefers-reduced-motion` disables nonessential motion.
- Manual production smoke tests cover Pages, real magic link, real Resend acceptance, scheduler heartbeat, duplicate recovery invocation, and encrypted restore.

### Mandatory gate

Agent 4 must run clean install, formatting/lint, typecheck, every unit/component/local Supabase/Edge/E2E test, and production build. Missing credentials may skip only live production smoke tests, which must then be completed manually before deployment sign-off; no core test may be skipped. A dev server starting is not completion.

## 18. Cost, reliability, backup, and operations

### $0/month hobby infrastructure profile

- Public GitHub repository + Pages on GitHub Free; source is public, but private data and secrets remain in Supabase/service stores.
- Supabase Free for database/Auth/Edge/Cron, subject to current quotas, possible inactivity pause after about one week, no SLA, and no automatic backups.
- Resend Free currently allows up to 3,000 emails/month and 100/day, adequate for one user, but production sending requires an owned verified domain.
- Recurring infrastructure: $0/month; required domain commonly costs approximately USD $10–$25/year. Recheck all prices/limits at deployment.
- Compensating controls: weekly encrypted JSON export, quarterly restore test, dashboard scheduler-health checks, and documented unpause/recovery.

### Operationally reliable profile

- Supabase Pro currently starts around USD $25/month for reduced pause risk, production features/backups subject to current plan terms, plus the required domain.
- Public Pages can remain $0; private-source Pages requires an eligible paid GitHub plan (GitHub Pro is currently about USD $4/month for an individual—verify eligibility/pricing).
- Resend Free remains sufficient until volume/reliability needs a paid mail plan. Minimum described profile is about $25/month + domain with public source, or about $29/month + domain with paid private-source GitHub.
- Even with provider backups, keep monthly encrypted exports and semiannual restore drills; backups are useful only when tested.

### Routine operations

- Review dashboard health/failed or `requires_review` notifications weekly and provider/security logs monthly.
- Test benefit and Auth mail after credential/DNS changes; rotate secrets independently and record the date.
- Review Dependabot PRs, pinned Action updates, Supabase advisories, quotas, and pricing; never auto-merge security-sensitive updates.
- Monitor database/export size and Edge/Cron/email quotas. Upgrade or prune only through documented, non-destructive retention decisions.

## 19. Risks and mitigations

- **Free-tier pause/no backup:** may delay reminders or lose provider-side recovery; health warnings, paid option, encrypted exports, and restore drills mitigate it.
- **Public scheduler endpoint:** required for Cron/Actions; single-function JWT exception, high-entropy header, POST-only/no-CORS, rate bounds, and rotation limit exposure.
- **Email exactly-once impossibility:** external crash ambiguity cannot be eliminated; immutable payload/key within 24 hours and `requires_review` afterward favor duplicate prevention.
- **Direct browser data API:** a compromised session is powerful; deny-by-default RLS/grants, RPC invariants, CSP/no raw HTML, tests, logout/revocation, and no financial credentials reduce impact.
- **Recurrence complexity:** original-anchor sequence, deterministic key, range exclusions, centralized code/fixtures, and exhaustive dates prevent drift/overlap.
- **Revision/edit complexity:** explicit scope and protected-instance rejection add UX steps but prevent historical corruption.
- **Two-decimal/custom-month scope:** excludes rare currencies and arbitrary intervals; clear validation/docs preserve correctness and a future migration path.
- **Provider acceptance is not delivery:** expose accurate state, provider IDs/failures, verified DNS, and optional future webhook rather than overstating success.
- **GitHub Pages code visibility/private-plan cost:** no secrets/data enter artifacts; users choose public source or eligible paid private Pages deliberately.

## 20. Implementation phases

1. **Consensus gate:** Agent 2 re-reviews this revision; implementation begins only after both agents explicitly approve it.
2. **Foundation/security:** frontend/tooling, local Supabase, schema constraints, grants/RLS/RPC skeleton, Auth PKCE, fake mail adapter, and mandatory CI.
3. **Domain:** date/timezone, recurrence/occurrence identity, revisions/instances, value/status, mutation RPCs, and exhaustive fixtures.
4. **Core UI:** owner auth, profiles/accounts, benefit forms/edit scopes, dashboard/attention/search/filter, redemptions/enrollment, errors/accessibility.
5. **Notifications:** Cron/Vault, Edge invocation contract, generation/claims, immutable Resend state machine, retry/review, health/recovery, and tests.
6. **Portability:** transactional import, canonical/CSV export, encrypted backup/restore documentation and tests.
7. **Deployment/docs:** protected backend, Pages, recovery workflows, exact variables, setup/update/troubleshooting, cost profiles, test procedures, and requirements matrix.
8. **Independent QA:** Agent 4 creates `REVIEW.md`; Agent 3 fixes every failure; Agent 4 reruns audit until `PASS`.

Agent 3 must follow this plan. If implementation reveals a material impossibility, stop that portion, document it, return an amendment to Agents 1 and 2, obtain shared approval, then continue.

## 21. Planned requirements traceability

| Requirement                      | Implementation location                                 | Verification                                              | Candidate status |
| -------------------------------- | ------------------------------------------------------- | --------------------------------------------------------- | ---------------- |
| Private persistent data          | Supabase schema/Auth/RLS/RPCs                           | reload/redeploy + two-owner isolation                     | Planned PASS     |
| Accounts/providers               | `accounts`, account UI                                  | CRUD/deactivate/safe-field tests                          | Planned PASS     |
| Flexible values/eligibility      | definitions/revisions/value units                       | fixed/capped/uncapped cashback/points/membership fixtures | Planned PASS     |
| Effective/enrollment/reset dates | definition/revision fields + attention                  | deadline/reset/date tests                                 | Planned PASS     |
| Timezone safety                  | profile RPC + Temporal/domain                           | DST/month/zone-change suite                               | Planned PASS     |
| Recurrence/history               | immutable revisions, versioned occurrence-key instances | close/concurrency/calendar/backfill/regeneration tests    | Planned PASS     |
| Multiple redemptions             | locked redemption/completion RPCs/view                  | finite overuse + uncapped earn/complete tests             | Planned PASS     |
| Independent status               | lifecycle/usage view + flags                            | cross-product status/UI filter tests                      | Planned PASS     |
| Dashboard/search/filter          | responsive pages/features                               | E2E at 320/768/1280                                       | Planned PASS     |
| Expiration email                 | event selector + Edge/Resend                            | boundary/late/overdue/used tests                          | Planned PASS     |
| Reactivation email               | genuine activation event                                | recurrence/start/backfill suppression tests               | Planned PASS     |
| Idempotency/failure safety       | unique event, claims, immutable payload                 | concurrency/crash/23h/24h tests                           | Planned PASS     |
| Offline scheduler                | Supabase Cron/Vault + Edge                              | heartbeat/stale/recovery tests                            | Planned PASS     |
| Scheduler recovery               | protected GitHub dispatch                               | duplicate manual invocation test                          | Planned PASS     |
| Authentication                   | owner-only PKCE + custom SMTP                           | local/Pages callback and unknown-email tests              | Planned PASS     |
| Secrets/security                 | matrix, CSP, grants, protected env                      | secret scan/tamper/negative access tests                  | Planned PASS     |
| Import/export                    | canonical JSON/CSV + import RPC                         | malformed rollback/round-trip/restore                     | Planned PASS     |
| GitHub deployments               | CI/Pages/backend workflows                              | clean pipeline + production smoke                         | Planned PASS     |
| Accessibility                    | semantic responsive UI                                  | axe + keyboard/screen-reader/manual                       | Planned PASS     |
| Costs/backups                    | hobby/reliable profiles + runbook                       | pricing check/export restore drill                        | Planned PASS     |
| Documentation                    | README/DEPLOYMENT/REQUIREMENTS                          | Agent 4 completeness audit                                | Planned PASS     |

The implementation-stage `REQUIREMENTS.md` will expand every major user requirement to exact files/tests and replace “Planned PASS” with evidence-backed `PASS`/`FAIL`.

## 22. Agent 1 approval

Agent 1 concludes that this revised architecture is workable, appropriately small, deployable from GitHub, secure for the stated personal use, calendar-correct, history-preserving, observable, and explicit about provider/free-tier limits. Agent 1 **APPROVES Final Candidate Plan v3**.

Agent 2 independently reviewed the exact Final Candidate Plan v3 architecture recorded in `PLAN_CONSENSUS.md` and **APPROVES** it. Both agents approve the same plan; the implementation gate is **OPEN** and Agent 3 is authorized to begin.
