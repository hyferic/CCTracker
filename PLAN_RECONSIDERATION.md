# Agent 1 — Reconsideration of Agent 2 Review

**Artifact reviewed:** `PLAN_REVIEW.md`, in full  
**Reconsideration date:** 2026-08-18  
**Implementation gate:** Still blocked until Agent 2 approves the revised `PLAN.md`

Agent 1 reassessed each issue against the product requirements rather than presuming the review was correct. The core React/Pages + Supabase + Resend split remains appropriate, but the review identifies real defects in invocation, scheduling, notification ambiguity, mutation privileges, and recurrence lifecycle. The decisions below govern the revised plan.

## Critical issues

### C-1 — Scheduled Edge Function request contract: ACCEPT

The original `Authorization: Bearer <CRON_SECRET>` contract conflicts with Supabase's default gateway JWT verification. The revised plan sets `verify_jwt = false` only for `process-notifications`, accepts only `POST`, uses `X-Scheduler-Secret`, performs constant-time comparison, exposes no browser CORS, and returns generic failures. The endpoint is publicly reachable but credential-gated. Unauthorized, missing/wrong-secret, user-JWT-only, wrong-method, and valid-secret integration cases become mandatory. Resend's idempotency header is mandatory, not conditional.

### C-2 — Durable primary schedule and catch-up: ACCEPT

GitHub scheduled workflows can be delayed, dropped, or inactivity-disabled, so they are a poor primary clock for an unattended personal app. Supabase Cron, installed by migration and calling the existing Edge Function through `pg_net` with the scheduler secret in Vault, becomes primary. It runs every 15 minutes at minute offsets 7/22/37/52, enabling retries within Resend's 24-hour idempotency window without relying on a separate service. GitHub keeps a protected `workflow_dispatch` recovery trigger only. A heartbeat, dashboard/settings health warning after 36 hours, and recovery runbook are required. Expiration catch-up now includes every overdue unsent event while the instance remains active/eligible, rather than only three days.

### C-3 — Crash-safe notification identity and retry policy: ACCEPT

`scheduled_for` is mutable schedule data and cannot be part of logical identity. The revised unique key is `(benefit_instance_id, notification_type)`. Recipient, subject, rendered body, payload hash, and provider idempotency key are frozen atomically before the first attempt. Every attempt uses the notification UUID and byte-identical payload. Outcomes distinguish definitive failure, retryable failure, ambiguous transport, provider accepted, skipped, and `requires_review`; “sent” means provider accepted unless delivery webhooks are later added. Automatic ambiguous/retryable attempts use the same key and finish before 24 hours; an unresolved/ambiguous event at or beyond that boundary is never automatically resubmitted. Concurrency, crash-after-acceptance, immutable payload, 23-hour retry, and post-window suppression are release tests.

### C-4 — RLS, grants, immutable history, and RPC boundary: ACCEPT

Owner-row RLS alone cannot protect lifecycle columns or enforce multi-row invariants. The revised plan contains a table/operation matrix. Authenticated clients directly update only simple account fields and a narrow profile RPC; all benefit/revision/instance/redemption/import mutations use transactional, narrowly granted RPCs. Lifecycle tables are read-only to clients; operations tables are private. Every `SECURITY DEFINER` function has empty `search_path`, fully qualified names, explicit `auth.uid()`/ownership checks, and revoked `public`/`anon` execution. Aggregate views use `security_invoker=true`. Composite owner foreign keys and immutable/generated snapshots prevent cross-owner or historical rewriting.

### C-5 — Atomic creation/edit/disable and occurrence identity: ACCEPT

The original direct-CRUD description contradicted revisioned history. The revised plan defines atomic `create_benefit`, scoped `edit_benefit`, `set_recurrence_enabled`, `override_instance`, and redemption RPCs. Creation writes the definition, first revision, and immediately relevant instance(s) in one transaction. Future edits and disablement void only unstarted, unused, unnotified future instances; re-enablement regenerates from the next genuine boundary. Current/history remain intact, protected current instances cannot be silently rebased, and value cannot fall below redeemed value. `occurrence_key` derives from the original recurrence anchor/sequence, remains stable when visible boundaries are clipped, and combines with a live-range exclusion constraint to prevent duplicates and overlaps.

## Major issues

### M-1 — PKCE callback with HashRouter: ACCEPT

Implicit-flow fragments conflict with `HashRouter`. The revised plan mandates Supabase PKCE (`flowType: 'pkce'`), exact repository-root/local redirect URLs, code exchange before router mount, query removal, then navigation to `#/dashboard`. It documents that a PKCE email link must open in the browser that initiated sign-in and includes local/production callback tests.

### M-2 — Owner bootstrap and production Auth SMTP: ACCEPT

The original alternatives were not deployable instructions. The selected flow is: create/invite the owner in the Supabase Dashboard, keep confirmed email required, disable public/anonymous signup, and call `signInWithOtp` with `shouldCreateUser: false`. Resend custom SMTP uses a separate credential in Supabase Auth settings and a verified sender/domain; it never enters frontend, Edge, repository, or GitHub settings. Documentation must cover disabling link tracking and the risk that link scanners consume magic links, plus recovery/admin access.

### M-3 — GitHub backend deployment: ACCEPT

GitHub-based deployment should cover the backend. A protected `deploy-backend.yml`, invoked manually or by an approved release environment, validates and applies migrations and deploys the Edge Function with pinned versions. It uses GitHub-only `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, and `SUPABASE_DB_PASSWORD`; the plan states origin, placement, scope, rotation, and that none are browser-safe. Resend and Auth SMTP credentials remain stored at their services.

### M-4 — Independent validity and usage: ACCEPT

A single precedence status loses history. The revised model exposes `lifecycle_status` (`upcoming`, `active`, `expired`, `void`) and `usage_status` (`unused`, `partial`, `used`) independently, plus attention flags (`expiring_soon`, `recently_activated`, `reset_soon`, enrollment due). UI labels can compose them and filters address each axis.

### M-5 — Revision/occurrence constraints and source of truth: ACCEPT

The plan now requires a partial unique index for one open revision, exclusion constraints for overlapping revision/live-instance date ranges, deterministic occurrence keys, and same-owner composite foreign keys. Normalized revision columns are authoritative; snapshot JSON is database-generated and immutable, not a second editable source.

### M-6 — Recurrence policies: PARTIALLY ACCEPT

Agent 1 accepts explicit reset-date mapping, original-anchor-plus-sequence arithmetic, stable occurrence identity under clipping, bounded backfill, and reactivation suppression for creation/import/backfill. Agent 1 does not add day/week/year custom units in v1. “Custom” deliberately means every positive N calendar months, which covers anchored monthly/quarterly/semiannual/annual-style benefits without reintroducing `expiration + N days`; this limitation is labeled in UI/docs. Arbitrary-unit recurrence can be a later schema-versioned feature.

### M-7 — Reminder eligibility/rescheduling: ACCEPT

The revised plan specifies late entry, expiration edits, redemption deletion after due date, preference defaults, deactivate/reactivate, and pre-generated periods. An eligible active benefit entered with 0–6 days left is queued once on the next run. An unsent event may be rescheduled in place; an attempted/accepted immutable event is never replaced by a second logical email. Deactivation skips pending work; reactivation can revive an unattempted same event if still active/eligible but never creates another. Reactivation mail waits for the local period start.

### M-8 — Currency and non-money behavior: ACCEPT

Summaries will group monetary values by currency without FX conversion and report points/membership/other separately. Accounts gain annual-fee currency. Percentage-cashback redemption records benefit value earned, not gross purchase spend, and cap remainder is labeled potential value. V1 explicitly supports fiat values to two decimal places; it does not claim unrestricted ISO minor-unit support. Points use whole units and membership/other use an explicit count/unit/boolean-style quantity.

### M-9 — Transactional server-side import: ACCEPT

Client preview is not authoritative. A typed `import_backup(jsonb, duplicate_policy)` RPC independently validates schema version, payload/row limits, types, dates, two-decimal currency policy, recurrence combinations, references, ownership, and duplicates. It generates IDs and maps references, ignores supplied ownership/notification/privileged state, and rolls back on any failure. Canonical JSON restores accounts, definitions, revisions, instances, and redemptions; notification rows may be exported for audit but are never restored. CSV imports definitions/accounts only.

### M-10 — Mandatory local integration CI: ACCEPT

Conditional integration tests are not a release gate. CI must start/reset a deterministic local Supabase stack, apply all migrations, test RLS/grants/RPCs, run the Edge Function against a fake Resend transport, and run unit, component, auth E2E through local Inbucket/fixtures, lint, typecheck, and production build. Core recurrence, claims, crash recovery, and access control use no production credentials. Live services are deployment smoke tests only.

### M-11 — Cost, reliability, and recovery profiles: ACCEPT

The revised plan separates a $0 hobby profile from a reliable profile. Hobby uses a public GitHub source repository/Pages, Supabase Free with pause/no-SLA/no-automatic-backup risk, Resend Free within its documented 3,000/month and 100/day limits, and a required owned verified domain (typically $10–$25/year). It requires weekly encrypted JSON export and quarterly restore drills. Reliable uses Supabase Pro (currently starting at $25/month), an owned domain, Resend Free until volume needs paid service, and either public Pages at $0 or a paid GitHub plan for private-source Pages (currently GitHub Pro about $4/month). Pricing is rechecked at deployment.

## Minor issues

### N-1 — Flow numbering: ACCEPT

The skipped number is corrected and the browser/RPC, primary cron, email, and recovery flows are renumbered coherently.

### N-2 — Timezone validation/change behavior: ACCEPT

Timezone changes go through an RPC that checks `pg_timezone_names`, not client validation. Existing date-only periods/history do not shift. The new zone affects local “today,” future generation/attention, and unattempted notification scheduling; attempted immutable payloads remain frozen. The UI warns before the change and tests cross-zone/DST behavior.

### N-3 — XSS/session threat model: ACCEPT

The revised plan acknowledges refresh-token browser storage. It forbids raw HTML/`dangerouslySetInnerHTML`, uses a restrictive meta CSP compatible with Pages, pins/reviews dependencies, supports logout and Supabase session revocation, and tells users to log out on shared devices. This reduces but does not eliminate XSS risk.

### N-4 — Enrollment deadlines: ACCEPT

Definitions gain `enrollment_required` and `enrolled_at`. Needs Attention shows required/uncompleted enrollment due in 7/30 days and missed deadlines; forms provide an explicit Mark Enrolled action.

### N-5 — Update bot and action pinning: ACCEPT

Dependabot is selected; Renovate is removed. Third-party and official release actions are pinned to immutable commit SHAs, with readable version comments and controlled update review.

### N-6 — Accessibility verification: ACCEPT

Automated axe checks and manual keyboard/screen-reader/contrast review cover representative 320px, 768px, and 1280px widths. `prefers-reduced-motion` disables nonessential motion even though animation is intentionally minimal.

## Suggested improvements

1. **ACCEPT:** Retain React/Vite/TypeScript, Pages, Supabase, and Resend; the corrected boundaries make this a small viable system.
2. **ACCEPT:** Supabase Cron is primary and GitHub manual dispatch is recovery.
3. **ACCEPT:** Lifecycle mutations and imports use explicit RPCs with a published grants/RLS matrix.
4. **ACCEPT:** A shared pure TypeScript domain package is used where browser/Deno compatible; server constraints/RPCs are authoritative and shared fixtures are mandatory.
5. **ACCEPT:** Add occurrence identity, independent state axes, value units, immutable notifications, and `requires_review`.
6. **ACCEPT:** Surface last successful scheduler run and stale health on dashboard/settings.
7. **ACCEPT:** Protected backend deployment and deterministic local integration CI are first-class deliverables.

## Missing requirements disposition

- Reset date is now an explicit form concept mapped to recurrence basis/anchor fields.
- Creation immediately materializes one-time/current/upcoming instances transactionally.
- Lifecycle and usage are independent in storage-derived views, UI, and filters.
- Enrollment deadlines have actionable state and dashboard priority.
- Future-instance reconciliation and notification behavior are defined for recurrence edits, disablement, and reactivation.
- PKCE callback, owner bootstrap, Resend Auth SMTP, and link-scanner limitations are deployable requirements.
- GitHub deploys validated migrations/functions through an approved backend workflow with a complete secret matrix.
- Scheduler heartbeats, stale warning, overdue catch-up, and manual recovery are explicit.
- Local Supabase/Edge integration execution is mandatory in CI.
- Hobby-tier encrypted export and restore drills compensate for absent automatic backups.

## Agent 1 conclusion

Agent 2's `APPROVE WITH CHANGES` is well-founded. All critical issues are accepted; M-6 is partially accepted only to retain the deliberately bounded “every N calendar months” custom recurrence scope. The revised `PLAN.md` incorporates these decisions as one internally coherent final candidate rather than an amendment list. Agent 1 approves that revised candidate for implementation, subject to Agent 2 independently confirming consensus. No implementation is authorized yet.

## Round 2 — Reconsideration of `PLAN_FINAL_REVIEW.md`

**Artifact reviewed:** `PLAN_FINAL_REVIEW.md`, in full  
**Round 2 date:** 2026-08-18  
**Implementation gate:** Remains closed until Agent 2 approves Final Candidate Plan v3

Agent 1 confirms that the prior C-1–C-5, M-1–M-11, and N-1–N-6 resolutions remain unchanged. The three remaining items are concrete model contradictions rather than requests to revisit the service architecture.

### R-1 — Occurrence versioning and future regeneration: ACCEPT

The absolute `(definition_id, occurrence_key)` uniqueness in v2 would indeed reject the plan's own void-and-regenerate transaction. V3 selects one explicit model: every generated row has an `instance_version`; voided rows remain immutable audit versions; `(definition_id, occurrence_key, instance_version)` is absolutely unique; and a partial unique index on `(definition_id, occurrence_key) WHERE void_time IS NULL` permits exactly one live version. The existing partial live-range exclusion remains. Regeneration is allowed only for unstarted instances with no redemption and no notification attempt, under a definition/live-instance lock. Old never-attempted notifications become `superseded` and point to the replacement; the new live instance receives new notification state. Tests cover value-only same-key versioning, anchor-changing revisions, concurrent regeneration, audit retention, supersession, and rejection of two live versions.

### R-2 — Revision closure versus immutability: ACCEPT

V2 overstated revision immutability. V3 makes all authoritative value, eligibility, recurrence, `valid_from`, and generated snapshot fields permanently immutable, while permitting exactly one lifecycle transition of separate closure metadata: `valid_to NULL → new_revision.valid_from - 1 day`. `edit_benefit` locks the definition, closes the open revision through an unexposed privileged helper, and inserts the successor in one transaction. The trigger/deferred constraints reject direct close, reopen, a second close, gaps/overlap, or any other field mutation. The snapshot excludes `valid_to`, so closing metadata does not rewrite the immutable business snapshot. Tests cover ordinary-caller denial, close/reopen tampering, concurrent edits, one-open-revision enforcement, and non-overlapping closed ranges.

### R-3 — Uncapped percentage cashback: ACCEPT

An optional issuer cap requires nullable finite availability. V3 makes instance availability/remaining null only for uncapped percentage cashback and renders both as “Uncapped”; earned-to-date remains the sum of redemption values. It is excluded from finite Available Value totals and reported in a separate uncapped count. Usage is unused before redemption, partial after any redemption, and used only after explicit `mark_uncapped_complete`; capped offers retain normal cap arithmetic. Incomplete uncapped offers remain expiration-reminder eligible, with email showing “Uncapped” and earned-to-date instead of fabricated remaining value. Creation, multiple redemption, completion, reminder, summary, and filter tests become mandatory.

### Non-blocking clarification 1 — Auth invitation ordering: ACCEPT

Deployment instructions will configure verified-domain Resend custom SMTP before sending an owner invitation. Direct Dashboard user creation remains possible, but no invitation step may rely on Supabase's limited default SMTP.

### Non-blocking clarification 2 — Restored current-instance notifications: ACCEPT

Canonical restore never restores notification authority or reactivation eligibility. V3 adds an explicit restore choice: default `suppress_current` prevents potentially duplicate expiration email for restored current instances; optional `schedule_fresh` warns that prior provider sends cannot be deduplicated and authorizes one new expiration event for each eligible unexpired/incomplete current instance. Genuine future occurrences generated after restore use normal notifications.

### Non-blocking clarification 3 — Cross-table value invariant wording: ACCEPT

V3 no longer describes availability-versus-redemption as a row `CHECK`. Finite-cap changes and redemptions go through RPCs that lock the instance and verify the aggregate; import uses the same locked validation, with a deferred constraint trigger as defense in depth before commit. Simple row checks cover only local nonnegative/type/nullability rules.

### Round 2 Agent 1 conclusion

All three blocking issues and all clarifications are accepted because each fixes a deterministic contradiction or an undefined required input case. Final Candidate Plan v3 retains all prior architecture and security decisions, makes the occurrence/revision invariants implementable, and gives uncapped cashback honest product semantics. Agent 1 approves v3 subject to Agent 2's exact-revision consensus check; implementation remains prohibited until then.
