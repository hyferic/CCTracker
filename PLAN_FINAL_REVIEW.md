# Agent 2 — Consensus Re-review of Final Candidate Plan v2

**Reviewed artifacts:** `PLAN_RECONSIDERATION.md` in full and all 549 lines of `PLAN.md`  
**Reviewed `PLAN.md` SHA-256:** `d29e2a3b77237431784464271f010c62bcf7a36ba76044031ef64118fe4a875b`  
**Re-review date:** 2026-08-18  
**Implementation gate:** **REMAINS CLOSED**

Agent 1 substantially and correctly addressed the initial review. The selected React/Pages + Supabase + Resend architecture is now coherent at the service boundary, and the revised scheduler, Auth callback, RLS/RPC boundary, notification state machine, deployment workflows, tests, and operational profiles are suitable. Agent 1's partial acceptance of M-6 is also reasonable: a clearly labeled “every N calendar months” custom recurrence satisfies the intended anchored benefit use cases without adding arbitrary day/week semantics.

Three finite data-model contradictions remain. Two would make approved edit operations fail at the database layer; the third leaves an explicitly optional cashback-cap case without valid balance/status semantics. Because Agent 3 is forbidden to redesign materially during implementation, these must be settled in the plan first.

## Resolution of Agent 2 critical issues

| Issue                                      | Agent 2 re-review      | Resolution evidence / remaining concern                                                                                                                                                                                               |
| ------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-1 — Edge invocation contract             | **RESOLVED**           | Section 10 sets `verify_jwt=false` only for the scheduler function, uses POST + `X-Scheduler-Secret`, no CORS, constant-time comparison, bounded work, generic failures, and mandatory negative/positive tests.                       |
| C-2 — Durable schedule                     | **RESOLVED**           | Sections 2, 10, 15, and 18 make Supabase Cron primary, move GitHub to protected manual recovery, add heartbeat/stale UI/runbook, and catch up eligible expiration events until period end.                                            |
| C-3 — External email idempotency           | **RESOLVED**           | Section 10 uses one event per instance/type, atomically frozen byte-identical payloads, a mandatory notification-UUID Resend key, retries within 24 hours, explicit outcome states, and `requires_review` beyond the provider window. |
| C-4 — RLS/grants/immutability              | **RESOLVED**           | Sections 5–6 provide a concrete operation matrix, read-only lifecycle tables, private operations, same-owner FKs, `security_invoker` views, narrowly granted RPCs, empty `search_path`, ownership checks, and adversarial tests.      |
| C-5 — Atomic lifecycle/occurrence identity | **NOT FULLY RESOLVED** | Atomic RPC and edit/disable policies are now explicit, but the absolute occurrence unique key conflicts with the required void-and-regenerate operation; see R-1.                                                                     |

## Resolution of Agent 2 major issues

| Issue                                 | Agent 2 re-review                       | Resolution evidence / remaining concern                                                                                                                                                                                                                                                                         |
| ------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M-1 — PKCE + HashRouter               | **RESOLVED**                            | Section 4 gives exact local/Pages redirect roots, code exchange before router mount, query cleanup, hash navigation, and same-browser guidance/tests.                                                                                                                                                           |
| M-2 — Owner bootstrap/Auth SMTP       | **RESOLVED**                            | Section 4 selects one owner bootstrap, disables account creation/anonymous access, uses `shouldCreateUser:false`, and separates verified-domain Resend SMTP from benefit email credentials.                                                                                                                     |
| M-3 — GitHub backend deployment       | **RESOLVED**                            | Sections 14–16 add a protected, pinned backend workflow, exact deploy credentials and placement, migrations/function deployment, and safe smoke tests.                                                                                                                                                          |
| M-4 — Validity versus redemption      | **RESOLVED**                            | Section 7 independently derives lifecycle and usage, with attention flags and composite display labels/filters.                                                                                                                                                                                                 |
| M-5 — Revision/occurrence constraints | **NOT FULLY RESOLVED**                  | Partial-open-revision and range constraints are present, but revision immutability conflicts with closing the open revision (R-2), and occurrence uniqueness conflicts with regeneration (R-1).                                                                                                                 |
| M-6 — Recurrence policies             | **RESOLVED; PARTIAL ACCEPTANCE UPHELD** | Sections 8–9 explicitly map reset/anchor fields, compute from original anchor + sequence, preserve nominal boundaries/key under clipping, bound backfill, suppress non-genuine activation mail, and document custom recurrence as positive N calendar months. Arbitrary day/week units are not required for v1. |
| M-7 — Reminder edge policies          | **RESOLVED**                            | Section 10 covers late entry, overdue active benefits, date edits, redemption deletion, preference/deactivation revival, early generation, and immutable attempted events.                                                                                                                                      |
| M-8 — Currency/non-money behavior     | **NOT FULLY RESOLVED**                  | Currency grouping, two-decimal scope, points/membership units, and earned-cashback recording are resolved. An uncapped percentage benefit still lacks finite availability/status behavior; see R-3.                                                                                                             |
| M-9 — Import validation               | **RESOLVED**                            | Section 12 specifies authoritative transactional validation, limits, generated IDs/reference mapping, non-restorable privileged state, rollback, and separate canonical/CSV behavior.                                                                                                                           |
| M-10 — Mandatory integration CI       | **RESOLVED**                            | Sections 15 and 17 make local Supabase/Edge/Auth/UI tests unconditional and reserve only real-service smoke tests for manual deployment validation.                                                                                                                                                             |
| M-11 — Costs/recovery                 | **RESOLVED**                            | Section 18 clearly separates hobby and reliable profiles, identifies pause/backup/no-SLA/domain/private-Pages tradeoffs, and mandates export/restore drills.                                                                                                                                                    |

## Resolution of Agent 2 minor issues

| Issue                            | Agent 2 re-review | Resolution evidence                                                                                                                                      |
| -------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N-1 — Flow numbering             | **RESOLVED**      | Section 2 has a complete sequential flow.                                                                                                                |
| N-2 — Timezone validation/change | **RESOLVED**      | Sections 5 and 8 validate against `pg_timezone_names`, preserve stored dates, and define future/unattempted effects and tests.                           |
| N-3 — Browser session/XSS threat | **RESOLVED**      | Section 4 accurately acknowledges browser token risk and specifies text-only rendering, CSP, dependency hygiene, revocation, logout, and log exclusions. |
| N-4 — Enrollment deadlines       | **RESOLVED**      | Sections 5, 7, and 11 add enrollment state, 7/30-day attention, missed deadlines, filters, and Mark Enrolled.                                            |
| N-5 — Dependency update policy   | **RESOLVED**      | Section 13 selects Dependabot only and requires immutable Action SHAs with reviewed updates.                                                             |
| N-6 — Accessibility              | **RESOLVED**      | Sections 11 and 17 define responsive widths, axe automation, keyboard/screen-reader/contrast/touch review, non-color cues, and reduced motion.           |

## Remaining blocking concerns

### R-1 — Absolute occurrence uniqueness makes future regeneration impossible

Section 5 says `UNIQUE (definition_id, occurrence_key)` across all instances. Section 9 says a future edit voids an unstarted instance and inserts a regenerated instance for that same logical occurrence. The void row remains for audit, so the regenerated row necessarily has the same definition/key and violates the absolute unique constraint.

Required amendment: choose one consistent model and carry it through constraints, edit RPCs, notifications, and tests. The least disruptive choice is:

- retain voided versions for audit;
- enforce a **partial** unique index on `(definition_id, occurrence_key) WHERE void_time IS NULL`, so only one live version exists;
- retain the existing partial live-range exclusion constraint;
- allow regeneration only when the superseded version is unstarted, unused, and has no notification attempt;
- mark any old unattempted event superseded and create/reuse notification state only for the new live instance;
- test a value-only future revision with unchanged period/key, an anchor-changing revision, concurrent regeneration, and proof that two live versions cannot exist.

An alternative—in-place mutation or deletion of never-active future instances—is acceptable, but then the plan must remove “void and regenerate” and state the audit behavior. Agent 3 must not be left to choose.

### R-2 — Fully immutable revisions cannot be closed

Section 5 says a trigger rejects revision mutation after insertion. Section 9 requires `edit_benefit` to close the prior open revision before inserting the new open revision. Closing necessarily updates its validity end, so both rules cannot hold.

Required amendment: make authoritative snapshot/value/recurrence columns immutable, while permitting exactly one privileged transition of `valid_to` from null to the immediately preceding valid boundary through the lifecycle RPC under a definition lock. Once closed, `valid_to` is immutable. Direct browser mutation remains revoked. Add tests that ordinary callers cannot close/reopen/edit a revision, concurrent edits leave one open revision, and closed ranges remain non-overlapping.

### R-3 — Optional uncapped percentage cashback has no defined balance or terminal usage status

The requirements make cashback cap optional. The v2 schema permits an optional `cashback_cap`, but every instance/status assumes an `available quantity`, computes remaining against it, and derives `used` only when redemptions reach that finite quantity. An offer such as “5% cashback, no cap” therefore cannot be represented honestly without inventing a cap.

Required amendment: define one explicit v1 policy. Recommended:

- for percentage cashback with a cap, instance availability is the cap and normal remaining arithmetic applies;
- for percentage cashback without a cap, availability/remaining are null and display as “Uncapped”; it is excluded from finite Available Value totals;
- redemption rows still record cashback earned;
- usage is `unused` before any redemption and `partial` afterward unless the user explicitly marks the instance complete via a tracked completion field/RPC; `used` then means manually complete, not cap exhausted;
- expiration reminders remain eligible while uncompleted and send earned-to-date/“Uncapped” rather than a fabricated remaining amount;
- add creation, multiple-redemption, explicit-completion, summary, filtering, and reminder tests for uncapped cashback.

A separate user-entered tracking ceiling is also viable, but it must be clearly distinct from the issuer's optional official cap.

## Non-blocking implementation clarifications

- When deployment documentation uses an Auth invitation rather than direct owner creation, configure custom SMTP before sending the invitation; the architecture already supports this ordering.
- Document that canonical restore deliberately does not restore notification authority and whether restored current instances may generate a fresh expiration event. This is an operational expectation, not a reason to reject the service architecture.
- In SQL, “available value not below redeemed total” requires a locked RPC/constraint trigger; it cannot be a simple cross-table `CHECK`. Section 9 already supplies the locked RPC, so implementation should phrase the database invariant accurately.

## Internal consistency and regression audit

- No regression was found in GitHub Pages/static-backend separation, PKCE callback handling, owner-only access, secret boundaries, server scheduling, timezone/date-only arithmetic, calendar/anniversary recurrence, historical redemption preservation, notification crash handling, import transactionality, deployment automation, testing, or cost disclosure.
- The primary architecture remains simpler than the original draft: Supabase owns database/Auth/Cron/function execution, Resend owns delivery, and GitHub owns source/CI/deployment/manual recovery.
- M-6's bounded N-month scope is maintainable and explicitly disclosed; it does not hard-code an issuer and can be schema-versioned later.
- R-1 and R-2 are deterministic database failures, not stylistic preferences. R-3 is a required input shape without defined semantics. All three have small, localized amendments and do not require changing vendors or the top-level architecture.

## Final recommendation

**APPROVE WITH CHANGES**

Final Candidate Plan v2 is very close, but Agent 2 does **not** approve this exact revision for implementation. `PLAN.md` must remain metadata-gated and no production code may begin. Agent 1 should amend R-1, R-2, and R-3, preserve the already resolved C/M/N decisions, approve the resulting exact revision, and return it for a short Agent 2 consensus check. Once those three contradictions are resolved without introducing a new inconsistency, the architecture should be approvable without another broad redesign.
