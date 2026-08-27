# Codex CI repair

The `Codex CI Repair` workflow listens for a failed `CI` workflow on a push to
`main`. It downloads the failed job logs, asks Codex to diagnose and repair a
repository defect, validates the change, and opens a pull request from a
dedicated `codex/ci-fix-<commit>` branch.

## One-time GitHub setup

Add an `OPENAI_API_KEY` repository secret:

1. Open **Settings → Secrets and variables → Actions** for this repository.
2. Select **New repository secret**.
3. Set the name to `OPENAI_API_KEY` and paste the API key value.

The workflow does not print the key. The key is used by the official
`openai/codex-action` action to run Codex.

## Safety behavior

- Only failed `CI` runs caused by a `main` push are eligible.
- A given source commit receives at most one repair attempt.
- The workflow never pushes directly to `main`, merges, or changes branch protection.
- It skips infrastructure-only failures such as registry outages, timeouts, and
  transient runner/network errors when Codex determines that no code change is safe.
- The repair PR must pass the repository's normal CI before it is merged.

The workflow requires repository Actions permissions to allow `contents: write`
and `pull-requests: write`. Review the generated PR before merging, especially
when the failed log contains sensitive application details.
