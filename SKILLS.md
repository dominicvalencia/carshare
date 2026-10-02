# CarShare — Development Workflows

## How to use this guide

This is a project workflow reference, not an automatically discovered or installed agent skill. Read it alongside [AGENTS.md](AGENTS.md), which defines project-wide rules. To make this reference part of an agent's normal workflow, add an instruction in the repository's `AGENTS.md` to consult the relevant sections of `SKILLS.md`.

Choose the workflow that matches the requested task. Combine workflows when a change crosses boundaries. Use current repository code, accepted decisions, and package scripts as evidence; the paths below are known project areas and must be confirmed in the actual checkout.

Each workflow describes its trigger, procedure, and completion evidence. It does not authorize deployment, live financial operations, unrelated changes, or advancement beyond an approved phase.

## Workflow index

| Workflow                      | Use when                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------- |
| Repository orientation        | Starting work or resuming a handoff                                             |
| Scoped feature implementation | Implementing an approved feature slice                                          |
| Booking and rental lifecycle  | Changing eligibility, availability, amendments, cancellation, pickup, or return |
| Payment and refund recovery   | Changing provider operations, reconciliation, or financial accounting           |
| Prisma migration              | Changing durable schema or investigating database drift                         |
| Background worker reliability | Changing jobs, retries, expiration, or notifications                            |
| Mobile experience             | Changing renter/owner screens, navigation, or refresh behavior                  |
| Admin and support experience  | Changing administrative projections or recovery actions                         |
| Regression diagnosis          | Investigating a bug or failed check                                             |
| Verification and checkpoint   | Preparing completed work for review or an authorized commit                     |

## 1. Repository orientation

**Trigger:** A new task, resumed task, or uncertain baseline.

1. Read root and applicable nested agent instructions and the latest relevant handoff.
2. Inspect the branch, HEAD, worktree, and existing diffs without modifying them.
3. Identify task-owned versus pre-existing changes, including protected files.
4. Read root/workspace manifests, scripts, and relevant architecture documents.
5. Locate the affected authority, API entry points, worker handlers, shared contracts, and consumers using `rg`.
6. Summarize the requested result, permitted scope, current implementation, and acceptance checks. Verify current phase and migration state rather than copying historical counts.

**Completion evidence:** Relevant paths and commands identified; protected changes understood; unresolved facts separated from implementation choices. Do not print secrets or full environment files during inspection.

## 2. Scoped feature implementation

**Trigger:** An approved behavior change or implementation slice.

1. Translate the request into observable acceptance criteria, including relevant failure behavior.
2. Trace existing code and reuse its conventions and domain authorities.
3. Identify required contract/schema changes before changing consumers.
4. Implement the smallest cohesive change across the affected packages.
5. Add meaningful regression coverage for changed business behavior; avoid tests that merely restate implementation details.
6. Run focused checks, inspect the diff, and complete the required checkpoint verification.

**Completion evidence:** Acceptance criteria satisfied, callers/contracts consistent, no unrelated refactor or placeholder behavior, checks reported accurately.

## 3. Booking and rental lifecycle

**Trigger:** Changes to booking eligibility, amendments, holds, cancellation, pickup, return, or ACTIVE extensions.

1. Map current states, allowed transitions, actor permissions, and the existing transactional authority.
2. Identify the authoritative booking and immutable amendment snapshots. Confirm the approved policy for the requested change.
3. Enumerate competing events: owner decision, payment deadline, hold expiry, cancellation, pickup, return, worker execution, and stale client submission.
4. Enforce eligibility and availability inside the established transaction/locking strategy.
5. Apply booking changes only through the approved application stage. Preserve original terms until `APPLIED` and release only resources owned by the relevant operation.
6. Update projections and consumers without creating a second lifecycle authority.
7. Test the relevant valid transition, rejected transition, duplicate request, and competing event paths.

**Completion evidence:** Legal transitions and race outcomes covered; booking/hold invariants preserved; clients reflect authoritative state. ACTIVE extensions and pre-trip amendments remain distinct, and no automatic early-return refund is introduced.

## 4. Payment and refund recovery

**Trigger:** Provider initiation/status retrieval, callbacks, refund execution, reconciliation, ledger effects, cancellation offsets, or manual financial resolution.

1. Inspect provider interfaces, actual adapters, contract tests, and existing financial records. Consult current official provider documentation where semantics need verification.
2. Identify stable operation identity, provider correlation, idempotency key, amount/currency, entitlement snapshot, and allowed state transitions.
3. Separate accepted obligation, external money movement, and booking/economic application. Determine ledger effects at each stage using the approved accounting model.
4. Define recovery for timeout/UNKNOWN, duplicate callbacks, process crashes, and provider success followed by local persistence failure.
5. Obtain specific provider-supported outcome evidence before completing or repeating uncertain money movement. A payment status is not proof of an individual refund's status.
6. Preserve entitlement independently of reconciliation grace periods. Apply existing cancellation offsets to prevent duplicate refunds.
7. Keep manual resolution permissioned, auditable, evidence-based, and subject to the same uniqueness/accounting rules.
8. Test success, rejection, uncertainty, duplicate execution, persistence failure, reconciliation, and financial recovery paths relevant to the change.

**Completion evidence:** Durable correlation and recovery established; business effects occur once under retries; ledger remains balanced; owner/platform economics change only at the approved application stage. If provider evidence cannot resolve uncertainty, document the blocker rather than fabricate a success path.

## 5. Prisma migration

**Trigger:** A schema change or suspected drift in `packages/database`.

1. Read the Prisma schema, latest migrations, and migration-related tests.
2. Confirm the database target and current migration history without exposing connection secrets.
3. Separate an actual required schema change from unrelated drift or a test database missing existing migrations.
4. Create a forward migration only when needed. Assess existing rows, backfill safety, nullability, uniqueness, indexes, and compatibility with application reads/writes.
5. Preserve applied migration files and data. Do not reset a database or rewrite history to bypass a failure.
6. Generate/validate Prisma types using existing scripts and verify the migration against an isolated configured test database.
7. Test the constraint or business invariant that motivated the migration, including representative existing data when relevant.

**Completion evidence:** Migration necessity explained; target confirmed; schema/types/callers consistent; existing-data behavior verified; unrelated drift reported separately.

## 6. Background worker reliability

**Trigger:** Changes to reconciliation, application, expiration, notification delivery, or other jobs in `apps/workers`.

1. Trace job creation, durable authority, dispatch, claiming, retry policy, and completion recording.
2. Identify effects that must be protected against duplicate delivery or concurrent workers.
3. Recheck eligibility when executing; a queued job may be stale by the time it runs.
4. Preserve enough durable state to resume after interruption. Follow established transaction/outbox/claiming patterns where present.
5. Separate retryable failures from terminal or manually recoverable outcomes using existing conventions.
6. Test duplicate jobs, stale jobs, interruption/retry, and competing lifecycle events as relevant.

**Completion evidence:** Repeated execution is safe; stale jobs cannot corrupt current state; retry behavior is bounded and observable; notifications do not claim completion before the domain outcome is durable.

## 7. Mobile experience

**Trigger:** Changes to `apps/mobile` renter/owner screens, forms, navigation, or projections.

1. Inspect current screen composition, navigation types, API contracts, invalidation, and UI tests.
2. Define loading, empty, validation, submitting, failure, pending, and completed behavior relevant to the screen.
3. Use server eligibility/statuses and prevent duplicate submissions. Preserve user input appropriately on recoverable errors.
4. Show current/proposed terms and financial differences clearly for amendments. Derive countdowns from server timestamps without making the client a deadline authority.
5. Refresh authoritative data after application, background completion, or resume through existing centralized mechanisms.
6. Check safe areas, keyboard interaction, long content, accessibility, and navigation on relevant device sizes.
7. Run focused UI/contract checks and required iOS/Android exports. Visually inspect changed flows when interaction or layout matters.

**Completion evidence:** Screen matches server truth; pending/recovery states are explicit; stale state and duplicate actions handled; visual and platform checks reported.

## 8. Admin and support experience

**Trigger:** Changes to `apps/admin-web` or administrative API projections/actions.

1. Locate current routing, DTOs, authorization, audit logging, and panel conventions.
2. Distinguish read-only investigation from mutating recovery actions.
3. Show actionable status, relevant amounts/correlation, and permitted next actions without exposing secrets or unnecessary personal information.
4. Route mutations through existing domain authorities with server-side permissions, input validation, and audit evidence.
5. Handle stale state and repeated submissions; refresh authoritative data after actions.
6. Test permissions, projection correctness, invalid/stale actions, and relevant recovery outcomes.

**Completion evidence:** Support can understand and act on the state within permissions; no direct database workaround or duplicate financial authority; audit history retained.

## 9. Regression diagnosis

**Trigger:** A reported bug, failing test, reproducible timeout, or inconsistent state.

1. Capture expected versus observed behavior and a minimal reproduction.
2. Confirm the code baseline, database target, fixtures, and environment conditions relevant to the failure.
3. Reproduce with the smallest useful check; inspect callers and state transitions rather than guessing from an error message.
4. Determine whether the cause is product code, test isolation, asynchronous scheduling, schema mismatch, or external behavior.
5. Fix the cause within scope and add a meaningful regression test when appropriate.
6. Rerun the reproduction, affected suites, and required checkpoint checks.

**Completion evidence:** Cause supported by evidence; reproduction now passes; no skipped assertions, arbitrary delay, or inflated timeout conceals the problem. A passing isolated rerun does not establish that the full suite is green.

## 10. Verification and checkpoint

**Trigger:** A completed slice, review request, or authorized checkpoint commit.

1. Read current scripts and run focused tests plus required comprehensive checks. The known entry point is `pnpm verify`; confirm whether integration tests and platform exports run separately.
2. Include relevant formatting, lint, type checks, infrastructure validation, Prisma generation/validation, builds, and integration coverage.
3. Inspect final status/diffs and run `git diff --check`. Exclude generated output, secrets, dumps, logs, and unrelated files.
4. Classify every check as passed, failed, or not run. Diagnose reproducible failures before claiming acceptance.
5. If committing is authorized, stage explicit task-owned paths, inspect the staged diff, and keep inseparable schema/backend/consumer changes coherent.
6. Produce a concise handoff covering resulting behavior, affected areas, verification, remaining blockers, and commit hash if created.

**Completion evidence:** Reviewable diff; honest verification record; protected work preserved; checkpoint created only within authorization. Deployment and production operations require their own task authorization.

## Suggested handoff format

```text
Task / approved slice:
Resulting behavior:
Changed areas:
Decisions or contracts changed:
Verification passed:
Verification failed or not run:
Protected / pre-existing changes preserved:
Remaining blocker or next approved step:
Commit (if created):
```

Use only relevant fields. Avoid fixed test totals, migration numbers, or obsolete phase blockers in this guide; record current evidence in the task handoff.
