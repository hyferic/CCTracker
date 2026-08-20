# Agent 2 — Independent Review of Initial `PLAN.md`

**Reviewed artifact:** Agent 1 initial draft, 300 lines  
**Review date:** 2026-08-18  
**Current implementation gate:** **BLOCKED** pending revision and explicit consensus

The basic product split—static React frontend, hosted Postgres/Auth/Edge Function, and a transactional email provider—is appropriate. The draft also correctly rejects browser-only persistence and timers. However, several details would make the scheduled function fail, allow protected history to be mutated, or permit duplicate email after a crash. Those are plan defects, not implementation details, and must be resolved before Agent 3 begins.

## Critical issues

### C-1 — The scheduled Edge Function request will be rejected before its code runs

The draft sends `Authorization: Bearer <CRON_SECRET>` while leaving the function's gateway configuration unstated. Supabase Edge Functions enable JWT verification by default; an arbitrary bearer secret is not a valid Supabase user JWT, so the gateway returns 401 before the handler can compare it. Supabase explicitly distinguishes the JWT `Authorization` header from API-key/service authentication ([authorization headers](https://supabase.com/docs/guides/functions/auth-headers), [function configuration](https://supabase.com/docs/guides/functions/function-configuration)).

Required plan change:

- Choose one complete invocation contract. For a narrow custom scheduler credential, configure `[functions.process-notifications] verify_jwt = false`, send the secret in `X-Scheduler-Secret`, reject every method except `POST`, compare the secret in constant time, and return no useful detail on failure.
- State that the endpoint is reachable publicly but unusable without that high-entropy secret; do not enable browser CORS for it.
- Add unauthorized, wrong-secret, user-JWT-only, and valid-secret integration tests.
- Remove the ambiguous phrase “when supported” from security-critical provider behavior.

### C-2 — The primary GitHub schedule is not durable enough for unattended reminders

The plan mentions delay but omits that GitHub may drop scheduled runs under load and automatically disables scheduled workflows in a public repository after 60 days without repository activity. A finished personal app is likely to become inactive ([GitHub `schedule` documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)). A three-day catch-up cannot recover from that failure mode.

Required plan change:

- Make Supabase Cron the primary trigger because Supabase is already the backend; it supports persisted `pg_cron` jobs and Edge Function invocation, with secrets stored in Vault ([Supabase Cron](https://supabase.com/docs/guides/cron), [scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)).
- Keep GitHub `workflow_dispatch` as a documented manual recovery path, not the only durable schedule. If Agent 1 retains GitHub cron, it must instead select a repository/plan configuration that will not be inactivity-disabled and document its cost and monitoring.
- Schedule away from congested hour boundaries, store run heartbeats, surface “last successful run,” and document an alert/recovery procedure.
- Replace the three-day expiration catch-up with: send any unsent event whose target date has passed while its instance is still active and has remaining value; skip only after expiration or clear ineligibility.

### C-3 — Notification uniqueness and retries do not close the external-send crash window

`UNIQUE(instance_id, type, scheduled_for)` allows a second logical email if an edit changes `scheduled_for`. Also, a worker can successfully submit to Resend and crash before storing `sent`; reclaiming the row can submit again. Resend idempotency is real but mandatory only for 24 hours, not indefinite ([Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys)). Five unspecified exponential retries can cross that window.

Required plan change:

- Use one logical event key per instance/type, e.g. `UNIQUE(benefit_instance_id, notification_type)`. `scheduled_for` is mutable scheduling data, not identity.
- Freeze recipient, subject, rendered payload, and payload hash before the first provider attempt. Every retry must use the same notification UUID as `Idempotency-Key` and the identical payload.
- Complete automatic retries within Resend's 24-hour retention window. After an ambiguous attempt ages beyond that window, mark `requires_review` and never automatically send it with a fresh key.
- Distinguish definitive rejection, retryable rejection, ambiguous transport outcome, provider acceptance, and delivery. Document that `sent` means provider-accepted unless webhooks are added.
- Test concurrent claims, crash-after-provider-acceptance, payload immutability, retry at 23 hours, and suppression after 24 hours.

### C-4 — Owner-only RLS does not protect immutable history or business invariants

RLS controls rows, not which columns or lifecycle tables a user may mutate. The broad statement that authenticated users may “select/change” their own rows would let a client edit revision snapshots, instance period/value fields, ownership columns, or notification state. A compromised session could then rewrite history without crossing `user_id` boundaries. Views also bypass underlying RLS by default unless configured appropriately ([Supabase RLS and views](https://supabase.com/docs/guides/database/postgres/row-level-security)).

Required plan change:

- Add an explicit table/operation privilege matrix. Authenticated clients may read their revisions/instances/notifications but may not directly insert, update, or delete those lifecycle tables.
- Route benefit creation, scoped edits, recurrence changes, instance overrides, redemption mutation, and imports through narrowly granted transactional RPCs. Direct CRUD may remain only where invariants are simple, such as accounts and selected profile fields.
- For any `SECURITY DEFINER` RPC, set `search_path = ''`, fully qualify objects, verify `auth.uid()` and ownership in the function, revoke execution from `public`/`anon`, and grant only the intended signature to `authenticated`; these are documented Supabase safeguards ([database functions](https://supabase.com/docs/guides/database/functions)).
- Make aggregate views `security_invoker = true` or keep them outside the exposed schema. Put server-only operations tables in a private schema or revoke all Data API privileges.
- Use immutable/column privileges plus composite same-owner foreign keys so child `user_id` cannot diverge from its parent.

### C-5 — Creation, future pre-generation, edits, and recurrence disabling are not a coherent transaction model

The plan says browser CRUD writes definitions directly, yet every material change must create a revision and instances. It does not say how a one-time/current instance appears immediately. It pre-generates 31 days, but a later recurrence edit does not reconcile already-generated future instances. Finally, “disable recurrence but retain all existing instances” leaves unused future instances active and able to notify.

Required plan change:

- Define atomic `create_benefit`, `edit_benefit(scope, effective_boundary, ...)`, `set_recurrence_enabled`, and `override_instance` operations.
- Creation must write definition + initial revision + the current/upcoming or one-time instance in one transaction; the UI must not wait for the daily job.
- Future edits must void and regenerate only unstarted, unused, unnotified future instances; current and historical instances remain intact. Disabling recurrence must likewise void unstarted future instances while preserving current/history.
- Reject lowering an instance below redeemed amount. Define behavior for a current period already used or already notified.
- Give each occurrence a deterministic key and add a non-overlap invariant; exact `(definition_id, period_start, period_end)` uniqueness alone does not reject differently bounded overlapping periods.

## Major issues

### M-1 — Magic-link authentication and GitHub Pages hash routing need an explicit callback design

Supabase's default browser implicit flow returns access and refresh tokens in the URL fragment, the same fragment namespace `HashRouter` uses ([implicit flow](https://supabase.com/docs/guides/auth/sessions/implicit-flow)). “Configure redirects exactly” is insufficient.

Required plan change: choose and test one flow. Prefer PKCE, set `flowType: 'pkce'`, use an exact repository-root callback so the code is in the query string, exchange it before mounting the router, remove the query, then navigate to a hash route. Document that PKCE magic links must be completed in the initiating browser. List exact production and localhost Site/Redirect URLs ([redirect URL guidance](https://supabase.com/docs/guides/auth/redirect-urls)).

### M-2 — Owner enrollment and Auth mail are left as alternatives rather than a deployable choice

“Disable signup or enforce `ALLOWED_EMAILS`” does not specify an Auth hook and an Edge Function variable cannot constrain Supabase Auth. Required change: bootstrap the owner through the dashboard/admin path, set `shouldCreateUser: false` in the client, then disable “Allow new users to sign up” and anonymous sign-in. Keep confirmed email enabled.

Magic links also need production SMTP. Supabase's default SMTP is best-effort, limited to team addresses, and currently rate-limited to two messages per hour ([custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)). Configure Resend custom SMTP with a separate sending credential and verified sender; store it only in Supabase Auth settings. Document link-scanner and link-tracking caveats.

### M-3 — Backend deployment is manual despite the GitHub-based deployment requirement

The frontend has a Pages workflow, but migrations and the Edge Function are manual CLI work. Supabase recommends GitHub Actions for production migrations and documents Edge Function deployment through Actions ([environment deployment](https://supabase.com/docs/guides/deployment/managing-environments), [function deployment](https://supabase.com/docs/guides/functions/examples/github-actions)).

Required plan change: add a protected `deploy-backend.yml` (manual approval or controlled `main` release) that runs migration validation, applies migrations, and deploys the function using pinned tool/action versions. Add `SUPABASE_ACCESS_TOKEN`, project reference, and any required database credential to the secret matrix; explain origin, location, scope, rotation, and browser safety. Secrets for Resend/Auth remain at the service, not build artifacts.

### M-4 — Validity and redemption are conflated in one status

The precedence `Expired` before `Used` hides that an expired historical instance was fully redeemed. This fails the explicit review question about distinguishing validity from redemption.

Required plan change: derive independent axes: `lifecycle_status` (`upcoming`, `active`, `expired`, `void`) and `usage_status` (`unused`, `partial`, `used`). Treat `expiring_soon`, `recently_activated`, and `reset_soon` as attention flags. The UI may show a composite label such as “Expiring soon · Partially used,” while filters expose both axes.

### M-5 — Revision and occurrence constraints are incomplete

`UNIQUE(definition_id, revision_no)` does not enforce “one open revision,” and exact instance-range uniqueness does not reject overlap. The normalized recurrence columns and JSON snapshot also have no declared source of truth.

Required plan change: specify a partial unique constraint for one open revision, non-overlapping revision validity ranges, a deterministic occurrence key/non-overlap constraint for live instances, and which normalized columns are authoritative. Make any JSON snapshot generated/immutable rather than independently editable. Specify composite owner foreign keys for every relationship.

### M-6 — Several recurrence policies remain underspecified

The calendar and anniversary arithmetic is generally sound, including no-drift month-end and leap-day policy. But the plan must also:

- map the required user-facing “reset date” explicitly to calendar basis/anchor fields;
- either support custom interval units or state and justify that v1 custom recurrence means every N calendar months;
- compute every anniversary from the original anchor plus sequence index, never from the prior clipped date;
- preserve an occurrence key when effective/end dates clip displayed boundaries;
- define bounded historical backfill on creation/import so an old effective date does not silently create years of empty periods;
- suppress reactivation mail for imported/backfilled/current-at-creation periods, while scheduling it for the next genuine activation.

### M-7 — Reminder eligibility and rescheduling policies need completion

Required plan change: define late-entered benefits with fewer than seven days remaining (send once on the next run), edits to expiration before/after a send (reschedule the same unsent event; never silently create a second sent event), redemption deleted after the original due date, deactivation/reactivation, notification preferences defaulting on, and a new period generated ahead of its start (do not send until the local start date).

### M-8 — Multi-currency and non-money representation need precise behavior

Do not sum USD, EUR, points, and memberships into one “Available Value.” Group monetary summaries by currency and report points/non-money separately; do not invent FX conversion. Add annual-fee currency. Define whether percentage-cashback redemptions record benefit value earned (recommended) rather than gross spend, and label caps as potential remaining value. Either support ISO currency scales or document the narrower two-decimal scope instead of claiming unrestricted ISO-4217 with `numeric(14,2)`.

### M-9 — Import validation is described as server-side but only client Zod is concretely located

Required plan change: define a typed transactional import RPC (or server function) that independently validates version, row count/size, dates, currency, recurrence combinations, references, ownership, and duplicate policy. Never trust imported IDs/`user_id`/notification status. Generate new IDs and map references, preview first, and roll back the entire import on any failure. State whether canonical JSON restores history or imports definitions only.

### M-10 — The test plan permits required tests to be skipped

“Where credentials/local stack exist” is not a release gate. Required plan change: CI must start a deterministic local Supabase stack, reset all migrations, run database/RLS/RPC tests and Edge tests against a fake Resend transport, then run unit, UI, type, lint, and production build checks. E2E auth may use local Inbucket or an explicit tested fixture. Live Pages/Auth/Resend remain deployment smoke tests, but core recurrence, claims, crash recovery, and access control must be automated without production credentials.

### M-11 — Free-tier reliability and recovery costs are understated

Supabase currently states that Free projects pause after one week of inactivity and have no automatic backups, while Pro starts at $25/month ([pricing](https://supabase.com/pricing), [production checklist](https://supabase.com/docs/guides/deployment/going-into-prod)). Resend Free currently permits 3,000 emails/month and 100/day, but production sending generally requires an owned verified domain ([pricing](https://resend.com/docs/knowledge-base/what-is-resend-pricing), [domain verification](https://resend.com/docs/dashboard/domains/introduction)). GitHub Pages on GitHub Free requires a public repository; private-repository Pages requires a paid plan ([Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)).

Required plan change: present an explicit $0 hobby profile with pause/no-backup/no-SLA risk and an operationally reliable profile (at least Supabase Pro plus any GitHub/domain cost). The sender domain is not “optional” unless mail is intentionally restricted to Resend's testing recipient. Define periodic encrypted export/restore testing for the free profile.

## Minor issues

- **N-1:** The request-flow numbering skips item 2; correct it during revision.
- **N-2:** Specify server-side IANA timezone validation and behavior when the profile timezone changes. Client Zod alone is insufficient.
- **N-3:** A static SPA stores refresh tokens in browser storage, so “normal browser-origin controls” overstates protection. Document the XSS threat model: no raw HTML rendering, a restrictive meta CSP where Pages cannot set headers, dependency review, short session/revocation guidance, and logout on shared devices.
- **N-4:** Include enrollment deadlines in “Needs Attention”; they are collected but otherwise unused.
- **N-5:** Select either Dependabot or Renovate, not an unresolved pair, and pin third-party GitHub Actions to immutable commits for release workflows.
- **N-6:** Define accessibility verification at representative mobile/desktop widths and include reduced-motion behavior even though animation is minimal.

## Suggested improvements

1. Retain React/Vite/TypeScript, GitHub Pages, Supabase Postgres/Auth/Edge Functions, and Resend; this remains a sensible small architecture.
2. Move the primary daily trigger into Supabase Cron, installed by migration and authenticated from Vault; retain a protected GitHub manual recovery trigger.
3. Make server mutation RPCs—not direct table writes—the boundary for definitions, revisions, instances, redemptions, and imports. Publish a concise grants/RLS matrix in the plan.
4. Use a single shared pure TypeScript domain package for recurrence/date/status calculations where browser and Edge compatibility allows it. The server is authoritative; shared fixtures are mandatory if a database implementation differs.
5. Add `occurrence_key`, separate lifecycle/usage states, explicit instance value unit, immutable notification payload, and a `requires_review` notification outcome.
6. Add “last reminder run” health in Settings and make stale scheduler state visible on the dashboard rather than relying on the user to inspect GitHub or Supabase logs.
7. Make the backend deployment workflow and local Supabase integration suite first-class deliverables, not optional follow-up work.

## Architecture concerns

### Mandatory 18-question audit

|   # | Review question                             | Finding                                                                                                                                                 |
| --: | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | Does the architecture actually work?        | **No, as written.** The custom bearer request conflicts with default Edge JWT verification (C-1). The component selection is viable after correction.   |
|   2 | Is it unnecessarily complicated?            | Mostly no; revisions/instances are justified. GitHub cron duplicates scheduling already available in Supabase and adds failure modes.                   |
|   3 | Will GitHub deployment work?                | Frontend likely will after exact base/callback configuration; backend is not GitHub-deployed yet (M-1, M-3).                                            |
|   4 | Can the database safely persist data?       | Hosted persistence is suitable, but grants, same-owner FKs, view security, backups, and immutable mutation paths are incomplete (C-4, M-5, M-11).       |
|   5 | Can jobs run with the browser closed?       | Server-side execution can, but the chosen schedule can stop after repository inactivity (C-2).                                                          |
|   6 | Can email be sent without frontend secrets? | Yes. Resend belongs only in the Edge Function; Auth SMTP credentials belong only in Supabase settings.                                                  |
|   7 | Is recurring logic correctly designed?      | The calendar foundation is good, but creation, edit reconciliation, backfill, disable, and occurrence identity are incomplete (C-5, M-6).               |
|   8 | Are dates/timezones safe?                   | Largely yes: date-only periods, IANA timezone, and no implicit browser timezone are correct. Server validation and timezone-change policy remain (N-2). |
|   9 | Could reminders be duplicated?              | Yes, after rescheduling or a crash/provider timeout outside the 24-hour key window (C-3).                                                               |
|  10 | Can recurrence regenerate/reset correctly?  | Not reliably across pre-generated future instances, edits, or disable/re-enable until C-5 is resolved.                                                  |
|  11 | Is historical usage preserved?              | The intended definition/revision/instance model does, but broad client write rights currently undermine it (C-4).                                       |
|  12 | Is validity distinct from redemption?       | No; the single precedence status conflates them (M-4).                                                                                                  |
|  13 | Is the model flexible enough?               | Mostly, but reset mapping, custom interval scope, non-money units, and multi-currency aggregation need clarification (M-6, M-8).                        |
|  14 | Are secrets protected?                      | Browser/server separation is good; scheduler gateway behavior, Auth SMTP, and backend-deploy secrets are incomplete (C-1, M-2, M-3).                    |
|  15 | Are reasonable tests included?              | Coverage topics are strong, but the plan allows critical integration/E2E tests to be skipped (M-10).                                                    |
|  16 | Are dependencies unnecessary?               | No material excess. Temporal, Zod, Supabase, and the testing tools are justified; choose one update bot (N-5).                                          |
|  17 | Is there a simpler architecture?            | Yes: use Supabase Cron with the already-selected backend and keep GitHub only for source/deploy/manual recovery.                                        |
|  18 | Will it remain maintainable?                | Yes after establishing one authoritative recurrence implementation, explicit RPC/grant boundaries, and complete deployment/runbook automation.          |

## Missing requirements

- An explicit persisted/UI mapping for the optional reset date, rather than relying on readers to infer that `anchor` means reset.
- A working immediate creation path for one-time and current recurring instances.
- Independent validity and usage state exposed in dashboard filters and history.
- Defined handling of enrollment deadlines in the actionable dashboard.
- A safe policy for changing recurrence while future instances and notifications already exist.
- A complete production Auth callback plus custom SMTP procedure.
- A GitHub workflow that deploys migrations and the Edge Function, with every new secret/config value added to the final deployment matrix.
- A scheduler-health signal and recovery procedure for missed runs.
- Mandatory local integration execution in CI rather than conditional test language.
- Explicit backup/restore expectations for a free database tier with no downloadable automatic backups.

The final requirements matrix, README, deployment checklist, `.env.example`, migrations, workflows, and `REVIEW.md` are correctly planned as implementation deliverables and need not exist during this review stage.

## Final recommendation

**APPROVE WITH CHANGES**

The overall technology choice is approved in principle, but the current plan revision is **not approved for implementation**. Agent 1 must respond `ACCEPT`, `PARTIALLY ACCEPT`, or `REJECT` to each numbered C/M issue (and any rejected material minor issue), revise `PLAN.md`, and return the same final plan to Agent 2. Agent 2 should approve only after the Edge invocation contract, durable scheduling, crash-safe email policy, database privilege boundary, recurrence edit lifecycle, authentication callback, backend deployment workflow, and mandatory tests are explicit and mutually consistent.
