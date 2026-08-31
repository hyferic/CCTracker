## Multi-Agent Maker–Checker Workflow

For every material code, architecture, data-model, configuration,
security, integration, or UI change, use an independent multi-agent
review workflow.

### 1. Preserve the task contract

Before implementation, record:

- Primary user objective
- Explicit requirements
- Important constraints
- Acceptance criteria
- Non-goals

These remain authoritative throughout the task.

Reviewer findings may identify defects, but must not silently redefine
the original objective or acceptance criteria.

### 2. Delegate implementation

Delegate substantive implementation to a Worker subagent when
multi-agent delegation is available.

The Worker may:

- inspect the repository;
- create an implementation plan;
- modify code;
- add or update tests;
- run tests, lint, typecheck, and builds;
- report evidence of what was executed.

The Worker must not certify its own work as independently reviewed.

### 3. Spawn an independent Reviewer

After the Worker produces a candidate implementation, spawn a separate
Reviewer subagent.

The Reviewer must be independent from the Worker.

Prefer a fresh/forked context rather than inheriting the Worker's
reasoning.

Give the Reviewer only the information needed to review:

- original user objective;
- acceptance criteria;
- relevant repository context;
- actual git diff;
- changed files;
- test/lint/typecheck/build commands and results.

Do not give the Reviewer the Worker's private reasoning, self-review,
or conclusion that the implementation is correct.

### 4. Reviewer permissions

The Reviewer is read-only.

The Reviewer may:

- inspect code;
- inspect the diff;
- inspect tests;
- run non-destructive validation commands;
- inspect logs and build output.

The Reviewer must NOT:

- modify files;
- fix issues itself;
- commit changes;
- rewrite acceptance criteria;
- approve destructive or production actions.

### 5. Reviewer rubric

Review for:

#### Correctness
- Does the implementation satisfy the original request?
- Are important branches or edge cases missing?
- Are assumptions valid?
- Are regressions possible?

#### Tests
- Do tests cover the actual behavior?
- Are tests merely validating implementation assumptions?
- Are integration or real-path tests needed?
- Are failures or skipped tests being hidden?

#### Architecture
- Is the design unnecessarily complex?
- Does it fit existing repository patterns?
- Are responsibilities placed in the correct layer?
- Is backward compatibility preserved?

#### Security and privacy
- Secrets
- Authentication
- Authorization
- Input validation
- Sensitive logging
- Injection risks
- Unsafe external actions

#### UI/UX when applicable
- Loading state
- Empty state
- Error state
- Validation
- Accessibility
- Responsive behavior
- Keyboard interaction
- Visual regressions

### 6. Reviewer output

Return findings only when supported by evidence.

Classify each finding as:

BLOCKER
- likely makes the implementation incorrect, unsafe, or unusable.

IMPORTANT
- material issue that should be fixed before completion.

MINOR
- non-blocking robustness, maintainability, or polish issue.

For every BLOCKER or IMPORTANT finding include:

- issue;
- evidence;
- affected file/location;
- why it matters;
- recommended correction.

Do not invent findings merely to appear thorough.

### 7. Fix loop

If BLOCKER or IMPORTANT findings exist:

1. Return them to the Worker.
2. Worker fixes the implementation.
3. Worker re-runs relevant validation.
4. Spawn a fresh Reviewer pass on the updated diff.

Maximum automatic review/fix cycles: 2.

If material disagreement remains after 2 cycles, stop and report the
disagreement to the user instead of creating an endless review loop.

### 8. Completion authority

The Worker cannot declare the task independently accepted.

The Reviewer assesses the implementation but does not redefine the
task.

The main Orchestrator determines whether the acceptance criteria are
satisfied based on:

- implementation;
- test evidence;
- reviewer findings;
- original acceptance criteria.

Do not call the task complete merely because generated unit tests pass.

### 9. Skip rule

Do not spawn Worker + Reviewer agents for trivial tasks such as:

- typo fixes;
- tiny copy changes;
- simple README edits;
- straightforward read-only questions;
- changes whose correctness is immediately deterministic.

Use multi-agent review whenever an error would have meaningful
functional, security, data, architectural, or user-facing impact.
