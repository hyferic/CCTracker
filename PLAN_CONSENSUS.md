# Agent 2 — Final Planning Consensus

**Exact architecture reviewed:** `PLAN.md` Final Candidate Plan v3  
**Pre-approval SHA-256:** `f385ee62e8f266db6e296c21fc4c30e84eeb28bb0dd2d2fdbde404a71a43584d`  
**Reconsideration reviewed:** `PLAN_RECONSIDERATION.md`, Round 2  
**Decision date:** 2026-08-18

## Narrow resolution findings

- **R-1 resolved:** `instance_version` provides immutable audit versions; absolute definition/occurrence/version uniqueness plus partial live occurrence uniqueness permits void-and-regenerate while enforcing exactly one live version. Definition/live-row locking, notification supersession, and required concurrency/version tests make the operation coherent.
- **R-2 resolved:** revision business fields and generated snapshot remain immutable, while `valid_to` has one narrowly privileged null-to-adjacent-boundary closure transition. Definition locking, deferred adjacency/one-open checks, denied direct execution, and closure/reopen/concurrency tests reconcile revision history with scoped edits.
- **R-3 resolved:** uncapped percentage cashback uses null availability/remaining rendered as “Uncapped,” earned-to-date redemptions, explicit completion, separate summaries, correct reminder eligibility/content, and dedicated tests. It no longer invents a monetary cap.
- **Clarifications resolved:** production SMTP precedes invitations; restore requires an explicit duplicate-avoidance notification policy; finite cross-table redemption limits are enforced through locked RPC aggregation plus a deferred constraint trigger, not an invalid row-local check.

## Regression check

Final Candidate Plan v3 preserves the previously accepted resolutions for C-1–C-5, M-1–M-11, and N-1–N-6. No regression was found in:

- static Pages versus backend responsibility;
- owner-only PKCE authentication and SMTP setup;
- RLS, grants, same-owner relationships, private operations, and RPC security;
- Supabase Cron/Vault scheduling and protected GitHub recovery;
- frozen Resend payloads, 24-hour provider idempotency, claim recovery, and duplicate prevention;
- date-only timezone handling, recurrence anchoring, backfill bounds, edit scopes, and historical preservation;
- GitHub frontend/backend deployment, secret placement, deterministic CI, import/export, accessibility, costs, backup, and QA gates.

Agent 1's decision to define v1 custom recurrence as positive N calendar months remains approved: it is explicit, calendar-correct, issuer-neutral, and appropriately bounded.

## Final recommendation

**APPROVE**

Agent 2 approves the exact Final Candidate Plan v3 architecture identified by the pre-approval hash above. Agent 1 and Agent 2 therefore approve the same plan. The only subsequent `PLAN.md` edits authorized by this decision are approval metadata opening the implementation gate; they do not change architecture content. Agent 3 may begin implementation and must follow the approved plan/amendment gate described there.
