import { readFile } from 'node:fs/promises';

const [pagesWorkflow, backendWorkflow] = await Promise.all([
  readFile(new URL('../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8'),
  readFile(new URL('../.github/workflows/deploy-backend.yml', import.meta.url), 'utf8'),
]);

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

function rejectMatch(source, pattern, message) {
  if (pattern.test(source)) throw new Error(message);
}

requireMatch(
  pagesWorkflow,
  /^\s*workflows:\s*\[Deploy Backend\]\s*$/m,
  'Deploy Pages must be triggered by Deploy Backend.',
);
requireMatch(
  pagesWorkflow,
  /^\s*if:\s*github\.event\.workflow_run\.conclusion\s*==\s*'success'\s*$/m,
  'Deploy Pages must reject failed or cancelled backend runs.',
);
requireMatch(
  pagesWorkflow,
  /^\s*branches:\s*\[main\]\s*$/m,
  'Deploy Pages must accept backend runs from main only.',
);
rejectMatch(
  pagesWorkflow,
  /^\s*workflow_dispatch\s*:/m,
  'Deploy Pages must not have a manual bypass.',
);
rejectMatch(
  pagesWorkflow,
  /^\s*workflows:\s*\[CI\]\s*$/m,
  'Deploy Pages must not publish directly after CI.',
);

const exactCommitReferences = pagesWorkflow.match(/github\.event\.workflow_run\.head_sha/g) ?? [];
if (exactCommitReferences.length < 2) {
  throw new Error('Build and smoke jobs must both check out the exact backend-deployed commit.');
}

requireMatch(
  backendWorkflow,
  /^\s*workflow_dispatch\s*:/m,
  'Deploy Backend must remain an explicit operator action.',
);
requireMatch(
  backendWorkflow,
  /^\s*actions:\s*read\s*$/m,
  'Deploy Backend needs read-only Actions access for its exact-commit CI gate.',
);
requireMatch(
  backendWorkflow,
  /actions\/workflows\/ci\.yml\/runs[\s\S]*-f head_sha="\$GITHUB_SHA"[\s\S]*-f branch=main[\s\S]*-f status=success/,
  'Deploy Backend must require successful CI for its exact main commit.',
);
requireMatch(
  backendWorkflow,
  /\[\[ "\$GITHUB_REF" == "refs\/heads\/main" \]\]/,
  'Deploy Backend must reject non-main refs.',
);
requireMatch(
  backendWorkflow,
  /\[\[ "\$CONFIRM_PROJECT_REF" == "\$SUPABASE_PROJECT_REF" \]\]/,
  'Deploy Backend must require exact protected-project confirmation.',
);

console.log(
  'Release ordering is backend-first: exact-commit CI gate, protected backend deploy, then exact-commit Pages.',
);
