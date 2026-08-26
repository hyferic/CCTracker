# Production deployment checklist

Follow these steps in order. Replace every value in angle brackets. GitHub is the source/deployment control; GitHub Pages is only the static frontend. Supabase persists and secures data, runs Cron/Edge processing, and holds server secrets. Resend sends email.

Replacement values used below:

- `<OWNER>`: your GitHub username or organization.
- `<REPO>`: the GitHub repository name; the default is `credit-card-benefits-tracker`.
- `<PROJECT_REF>`: the short Supabase project reference shown in project settings and the project URL.
- `<DOMAIN>`: the DNS domain you verify in Resend.
- `<SCHEDULER_SECRET>`: a newly generated 64-character hex value; it is not your Supabase or Resend key.
- `<FUNCTION_URL>`: `https://<PROJECT_REF>.supabase.co/functions/v1/process-notifications`.
- `<RESEND_API_KEY>`: the server-only benefit-mail key created in Resend.

## Configuration and secret matrix

| Value                            | Obtain it from                                                                                       | Enter it in                                                                     | Browser-safe?                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------- |
| `VITE_SUPABASE_URL`              | Supabase → Project Settings → API → Project URL                                                      | Local `.env.local`; GitHub **repository variable**                               | Yes; URL only                                   |
| `VITE_SUPABASE_PUBLISHABLE_KEY`  | Supabase → Project Settings → API → Publishable key (legacy anon only if publishable is unavailable) | Local `.env.local`; GitHub **repository variable**                               | Yes **only** with the shipped RLS/grants        |
| `VITE_APP_BASE_URL`              | Final `https://<OWNER>.github.io/<REPO>/` URL                                                        | Local `.env.local`; GitHub **repository variable**                               | Yes; exact redirect root with trailing slash    |
| `VITE_BASE_PATH`                 | `/<REPO>/`                                                                                           | Local only if testing a subpath; Pages workflow computes it                     | Yes                                             |
| `RESEND_API_KEY`                 | Resend → API Keys; create a benefit-send-only key                                                   | Supabase Edge Function secret                                                   | **No**                                          |
| `RESEND_FROM_EMAIL`              | A verified sender such as `benefits@<DOMAIN>`                                                        | Supabase Edge Function secret                                                   | Address is not credential, but keep server-side |
| `SCHEDULER_SECRET`               | Generate at least 32 random bytes locally                                                            | Supabase Edge secret, Supabase Vault, GitHub `production` environment secret    | **No**                                          |
| `PROCESS_NOTIFICATIONS_URL`      | `https://<PROJECT_REF>.supabase.co/functions/v1/process-notifications`                               | Supabase Vault and GitHub **repository variable**                               | URL is non-secret; endpoint is header-protected |
| `SUPABASE_ACCESS_TOKEN`          | Supabase account → Access Tokens                                                                     | GitHub `production` environment secret                                          | **No**; CLI deployment scope                    |
| `SUPABASE_PROJECT_REF`           | Supabase project URL/settings                                                                        | GitHub **repository variable**                                                   | Yes; identifier only                            |
| `SUPABASE_DB_PASSWORD`           | Password chosen/reset in Supabase → Database settings                                                | GitHub `production` environment secret                                          | **No**                                          |
| Auth SMTP host/port/user/from    | Resend → SMTP and the verified `auth@<DOMAIN>` sender                                               | Supabase → Authentication → SMTP settings only                                  | Host metadata/address are non-secret; keep service-side |
| Auth SMTP password               | A second Resend key/SMTP credential, separate from benefit mail                                      | Supabase → Authentication → SMTP settings only                                  | **No**; never GitHub/Edge/frontend              |
| Edge `SUPABASE_URL`              | Supabase runtime injects the current project URL                                                     | Nowhere manually for the deployed function                                     | URL itself is safe                              |
| Edge `SUPABASE_SERVICE_ROLE_KEY` | Supabase runtime injects the current project service role                                            | Nowhere manually for the deployed function                                     | **No**; never copy or expose it                 |

Optional Edge runtime settings are `NOTIFICATION_BATCH_SIZE=10`, `NOTIFICATION_MAX_BATCHES=4`, `NOTIFICATION_CONCURRENCY=5`, `NOTIFICATION_LEASE_SECONDS=900`, `GENERATION_MONTH_LIMIT=24`, `NOTIFICATION_MAX_RUNTIME_MS=110000`, and `RESEND_TIMEOUT_MS=8000`. If changed, enter them as Supabase Edge Function secrets/config; they are not browser values. Defaults are appropriate for one owner. Production omits `MAIL_TRANSPORT` so it defaults to `resend`. `MAIL_TRANSPORT=fake`, `ALLOW_FAKE_MAIL_TRANSPORT=true`, and `FAKE_MAIL_OUTCOME` are local/CI-only and must never exist in production.

## 1. Create and protect the GitHub repository

1. Create a repository named, for example, `credit-card-benefits-tracker`.
2. Choose a public repository for free Pages or confirm your GitHub plan supports Pages from a private repository. Source visibility does not expose Supabase data/secrets.
3. From this project folder, create the local commit and remote, but **do not push yet**. The first `main` push triggers CI only. Pages is intentionally held until the same commit passes CI and the protected backend deployment succeeds, so configure the production values first.

   ```bash
   git init
   git add .
   git commit -m "Build private benefit tracker"
   git branch -M main
   git remote add origin https://github.com/<OWNER>/<REPO>.git
   ```

4. Create a GitHub environment named `production`; add required reviewers and restrict deployment branches to `main`. Its secrets are configured in step 6.
5. If the empty repository UI does not yet offer environments, Pages, or branch protection, return to those settings immediately after the first push in step 7.

## 2. Create Supabase and record identifiers

> **Catalog release ordering:** migrations `20260825000100_card_benefit_catalog.sql` and
> `20260825000200_expand_card_catalog.sql` must be applied
> by the protected backend workflow before deploying the matching frontend. Until then, the prior
> frontend remains compatible; after deployment, confirm `card_catalog_current` is readable only
> while authenticated, renewal-date inference works for anniversary templates, and Custom
> account/manual benefit creation still works.

1. Create a Supabase project in the region closest to you. Save the database password in a password manager.
2. Record Project URL, publishable key, project ref, and database password.
3. In Authentication settings disable anonymous sign-in and public/new-user signup. Do not create/invite the owner yet; production SMTP is configured first.
4. In Database → Extensions, enable `pgcrypto`, `btree_gist`, `pg_net`, `pg_cron`, and Vault (`supabase_vault`). Migrations also declare them; enabling Vault now allows safe pre-bootstrap.

## 3. Create the scheduler secret and Vault entries

Generate a secret locally; do not paste the command output into an issue or commit:

```bash
openssl rand -hex 32
```

Set `<SCHEDULER_SECRET>` to that 64-character result and `<FUNCTION_URL>` to:

```text
https://<PROJECT_REF>.supabase.co/functions/v1/process-notifications
```

In Supabase SQL Editor run once before the backend workflow:

```sql
select vault.create_secret('<SCHEDULER_SECRET>', 'scheduler_secret',
  'Authenticates Supabase Cron and protected GitHub recovery');
select vault.create_secret('<FUNCTION_URL>', 'process_notifications_url',
  'Public URL of the header-protected notification function');
```

Vault values are not committed migrations. To rotate, update the named Vault secret, Edge secret, and GitHub secret together, then run a health check.

## 4. Verify a sender domain and create separate mail credentials

1. Add a domain you control in Resend and copy its SPF/DKIM DNS records to your DNS provider.
2. Wait for Resend to show the domain as verified.
3. Create `benefits@<DOMAIN>` and `auth@<DOMAIN>` senders.
4. Create one API key limited to benefit email for `RESEND_API_KEY`.
5. Create a distinct SMTP credential for Supabase Auth. Do not reuse the benefit API key.
6. In Supabase → Authentication → SMTP, enter the exact host, port, username, and password shown by Resend, set the sender to `auth@<DOMAIN>`, and choose a sender name such as `PerkLedger`.
7. Disable link tracking for Auth mail; one-time magic links may otherwise be consumed by link scanners.

## 5. Set Edge Function secrets

Install dependencies, log in, and set server-only secrets:

```bash
npm ci
npm exec -- supabase login
npm exec -- supabase secrets set \
  --project-ref <PROJECT_REF> \
  RESEND_API_KEY=<RESEND_API_KEY> \
  RESEND_FROM_EMAIL=benefits@<DOMAIN> \
  SCHEDULER_SECRET=<SCHEDULER_SECRET>
```

Do not prefix any of these with `VITE_` and do not add them to `.env.local`.

## 6. Configure GitHub values

In repository Settings → Secrets and variables → Actions:

- Repository **variables**: `SUPABASE_PROJECT_REF`, `PROCESS_NOTIFICATIONS_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_APP_BASE_URL`. They must be repository-level because the Pages build job does not use the `production` environment.
- `production` environment **secrets**: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SCHEDULER_SECRET`.

Set `VITE_APP_BASE_URL=https://<OWNER>.github.io/<REPO>/` including the final slash. Obtain `SUPABASE_ACCESS_TOKEN` from the Supabase account access-token page; rotate/revoke it there. Fork pull requests receive no production secrets.

Do not create a GitHub `VITE_BASE_PATH` variable for the standard repository Pages URL; `deploy-pages.yml` deliberately derives it from the repository name.

## 7. Validate locally, make the first push, and protect `main`

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
node scripts/check-secrets.mjs
npm run build
```

With Docker and Deno available:

```bash
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

Without Docker, plain `npm run test:e2e` still runs the unauthenticated Chromium/WebKit accessibility shell and explicitly skips the authenticated contract. CI must set `E2E_AUTHENTICATED=true`; its preceding step derives real local browser-safe values and fails if they are missing.

Confirm no ignored local configuration or exported backup is staged:

```bash
git status --short
git ls-files '.env*' '*.backup.json'
```

Only `.env.example` should be tracked. Then push:

```bash
git push -u origin main
```

After the branch exists, protect `main`, require the CI checks, disallow force pushes, and confirm the `production` environment is restricted to `main`. In Settings → Pages select **GitHub Actions** as the source before deploying the backend. A CI run never deploys Pages by itself. Wait for every CI job to pass, then follow §8; successful backend deployment triggers Pages for that exact commit. If Pages was not enabled in time, enable it and rerun **Deploy Backend** for the same current `main` commit—the dry run and migration push are idempotent—and wait for the resulting Pages workflow.

## 8. Deploy database and Edge Function

1. Open Actions → **Deploy Backend** → Run workflow from `main`.
2. Enter the exact project ref and approve the protected `production` environment.
3. The workflow first verifies that CI succeeded for its exact `main` commit. It then links the project, lints/dry-runs/applies every migration, deploys only `process-notifications` with JWT verification disabled, rejects wrong scheduler authentication, and performs a valid non-sending health check.
4. In Supabase SQL Editor confirm/install Cron after migrations:

   ```sql
   select private.install_notification_cron();
   select jobid, jobname, schedule, active, command
   from cron.job where jobname = 'benefit-notification-processor';
   ```

   Expect `7,22,37,52 * * * *`, `active = true`, and `timeout_milliseconds := 120000` in `command`. This covers the Edge processor's configured 110-second bound. Re-running the installer safely replaces the named job.

5. In Edge Function settings confirm `verify_jwt=false` only for `process-notifications`; the high-entropy POST header is its authentication.
6. A successful backend run automatically starts **Deploy Pages** with `workflow_run.head_sha`; a failed or cancelled backend run cannot publish a frontend.

## 9. Configure Auth URLs and create the owner

In Supabase → Authentication → URL Configuration:

- Site URL: `https://<OWNER>.github.io/<REPO>/`
- Additional redirect: the same exact production root.
- Local redirect when needed: `http://localhost:5173/`

After custom SMTP is working:

1. Create/invite the single owner under Authentication → Users.
2. Require/confirm the email.
3. Confirm public signup and anonymous access remain disabled.
4. Do not enable a frontend password or store one in JavaScript.

## 10. Deploy Pages

Pages does not deploy directly after CI. The required release sequence is: push `main` → CI passes (including `scripts/check-release-order.mjs`) → an operator runs **Deploy Backend** for that exact `main` commit and production project → backend succeeds → `deploy-pages.yml` checks out that backend run's `workflow_run.head_sha`, builds with `VITE_BASE_PATH=/<REPO>/`, uploads `dist`, and deploys Pages. It receives only browser-safe `VITE_*` values. The workflow smoke checks assets, auth guard, and responsive rendering. There is no manual Pages fallback that can bypass the backend gate.

Open `https://<OWNER>.github.io/<REPO>/`, request a magic link, and open it in the same browser/device. Confirm the query-code exchange finishes before the hash route and the URL becomes `#/dashboard` without the code.

## 11. Production validation

Perform these in order:

1. Sign in as owner; confirm an unknown email cannot create an account.
2. Create a card/provider using only display metadata and optional last four.
3. Change the profile timezone to one whose local date differs from the browser date; confirm new benefit, redemption, enrollment, and notification-audit defaults follow the saved timezone, then restore the intended production timezone.
4. Create a monthly calendar benefit with an optional display reset date; confirm the reset date is shown and does not alter generated period boundaries.
5. Create quarterly, calendar-annual, anniversary-annual (August 15), and end-of-month test benefits. Verify January 31, February 28/29, April 30, August 31, and December→January against the original-anchor rule.
6. Create a $100 finite benefit; record $40 and $25; confirm $35 remains. Edit/delete one usage row and recheck.
7. Create capped and uncapped cashback; verify uncapped says “Uncapped,” records earned value, and uses Mark complete.
8. Test future-only, current-and-future, and one-period override. Confirm the operational dashboard defaults to live periods while labeled void/superseded versions remain under Period history and the Period versions audit filter.
9. Create enrollment deadlines that are missed, within 7 days, within 8–30 days, and beyond 30 days; confirm only the first three receive the appropriate non-overlapping attention label.
10. Confirm Settings shows the confirmed owner address as the read-only Verified notification recipient and that a direct RPC attempt to set a malformed or different address is rejected.
11. Create an expiration exactly seven days away with positive remaining value.
12. Create a genuinely future recurring period, then wait/adjust in a test project so its local start is processed.
13. Run Actions → **Manual Notification Recovery** with `health`; confirm no email is sent and a minimal healthy response appears.
14. Run `process` twice/concurrently using confirmation `PROCESS`. Confirm one instance, one logical event, one provider-accepted message/idempotency key, and a fresh heartbeat.
15. Inspect the Resend record and verify subject/body values. Remember provider acceptance is not guaranteed delivery.
16. Mark a benefit used before its reminder date and confirm it is skipped.
17. Simulate a slow/failed provider request in a non-production test project; confirm timeout/retry/review state is visible and other events proceed.
18. Refresh, close/reopen, and redeploy Pages; confirm data persists.
19. Test JSON export, encrypt/store it off-repository, validate import preview, and perform a `suppress_current` full-history restore drill in a disposable project.
20. Download the CSV import template. Add one `account` row and one linked `definition` row using `source_id`/`account_source_id` and pipe-delimited tags, preview/import it, and confirm the definition receives usable periods. Then introduce a bad reference and confirm the entire import rolls back. Do not use the separate flattened analysis exports as import templates.
21. Export CSV containing text beginning with `=`, `+`, `-`, and `@`; confirm spreadsheet applications display it as text while an actual negative numeric value stays numeric.
22. Sign out, revoke the session in Supabase, and confirm private data is inaccessible.

Treat steps 11–15 as the required test-email sequence: the seven-day fixture must produce `Benefit expiring soon: ...`, and the genuinely new recurring period must produce `Benefit available again: ...`. Do this first in a disposable/test Supabase project if changing dates or simulating provider failure would disturb real data.

## 12. Operations and recovery

- Review dashboard scheduler health and failed/`requires_review` counts weekly; review Resend/security logs monthly.
- If stale: unpause Supabase, inspect `cron.job_run_details` and Edge logs, verify Vault names and all scheduler-secret copies, run health, then one protected process recovery.
- Rotate benefit API, SMTP, scheduler, deploy token, and database credentials independently. Never log secret values.
- Review Dependabot and pinned-action updates; do not auto-merge security-sensitive changes.
- Export an encrypted backup weekly for the free profile or at least monthly for a paid profile; test restore quarterly/semiannually.
- Verify current Supabase, Resend, GitHub Pages, and domain prices/quotas before relying on the cost estimates in `PLAN.md`.
