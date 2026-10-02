# CarShare — Agent Instructions

Act as a senior full-stack engineer with strong UI/UX design skills. Build reliable, maintainable solutions across the API, database, workers, mobile app, and Admin web. Create polished interfaces with clear visual hierarchy, consistent spacing and typography, responsive layouts, accessible controls, and thoughtful loading, empty, error, and success states. Follow CarShare’s existing design patterns and prioritize clarity and ease of use.

## Purpose and scope

CarShare is a car rental marketplace with renter, vehicle owner, and administrative workflows. Work only on the requested task or approved implementation slice. Preserve existing booking, payment, ledger, availability, and rental lifecycle behavior unless the task explicitly changes it.

This file provides durable guidance. Determine the current phase, accepted decisions, baseline commit, migration state, and protected files from the repository and latest task handoff. Do not treat historical chat summaries or audit reports as current repository state.

## Repository orientation

CarShare uses a TypeScript pnpm monorepo. Known project areas include:

| Area                  | Responsibility                                                                |
| --------------------- | ----------------------------------------------------------------------------- |
| `apps/api`            | NestJS API, authorization, booking/rental services, payment endpoints         |
| `apps/mobile`         | React Native renter and owner experiences                                     |
| `apps/admin-web`      | Next.js administrative and support interface                                  |
| `apps/workers`        | Background processing, reconciliation, notifications, amendment application   |
| `packages/database`   | Prisma/PostgreSQL schema, migrations, transactional domain authorities        |
| `packages/payments`   | Payment provider contracts and adapters, including Maya and fake providers    |
| Other shared packages | Contracts, configuration, notifications, payouts, provider utilities, logging |

Confirm these paths and the current package scripts before using them. PostgreSQL holds durable business state; use Redis for supported ephemeral/job concerns and object storage for supported file flows. Follow existing integrations rather than introducing replacements.

## Before making changes

1. Read applicable nested `AGENTS.md` files, repository documentation, package scripts, and the latest relevant task handoff or architecture decision.
2. Inspect `git status --short`, the current branch/HEAD, and relevant diffs. Identify pre-existing edits and untracked files before editing.
3. Trace the affected flow across API, database, workers, contracts, mobile, and Admin as needed. Find the existing authority and callers before creating another implementation.
4. Establish the requested behavior, acceptance criteria, permitted scope, and meaningful verification commands.
5. Resolve ordinary implementation details autonomously. Ask a focused question only when an unresolved product/financial decision or missing fact materially blocks correctness.

Never overwrite, discard, stage, or commit unrelated user work. Historically protected files include `apps/mobile/src/navigation/deep-link-state.test.ts` and `packages/database/prisma/development-demo.ts`; inspect their current diffs and the latest handoff before touching them. Do not assume that an old protection list is exhaustive.

## Implementation workflow

- Use small, reviewable slices aligned with the approved phase. Finish required checks for the current slice before proceeding to a gated next phase.
- Keep changes cohesive across schema, contracts, API, workers, and consumers when they depend on one another. Do not split an inseparable change into broken intermediate checkpoints.
- Follow existing naming, module boundaries, formatting, dependency injection, and error handling. Prefer existing helpers and centralized guards over duplicated rules.
- Do not add dependencies, infrastructure, broad refactors, or unrelated features without a task-driven need.
- Keep UI-only and read-projection work within that scope; it must not silently change pricing, lifecycle, payment, or refund authority.
- Do not leave placeholders, bypasses, temporary logging, dead code, or fabricated provider behavior in completed work.
- Record a genuine architecture blocker with evidence and the smallest decision needed to resolve it. Continue independent authorized work where possible.

## Business authority and concurrency

- The server is authoritative for pricing, availability, eligibility, booking/rental transitions, financial state, and permissions. Clients display server projections and submit intent.
- Validate role and resource ownership on every relevant API operation. Administrative actions require their existing explicit authorization and audit trail.
- Keep state transitions centralized and enforce allowed source states. Do not update lifecycle fields through ad hoc UI routes or direct database patches.
- Revalidate relevant state inside the transaction. Use established locking, uniqueness constraints, or conditional writes to handle competing requests and workers.
- Protect against double booking and races among amendments, cancellation, pickup, return, expiration, payment capture, and reconciliation.
- Persist enough state to recover from a process crash or retry. An in-memory flag or successful HTTP response is not a durable business outcome.

## Booking amendments

- Preserve immutable amendment requests and accepted quote/policy snapshots. Original booking terms remain authoritative until the amendment is `APPLIED`.
- Require the established owner approval and server-side availability/requote checks. Do not replace the vehicle or widen amendment eligibility without an approved policy change.
- Preserve the approved distinction between pre-trip changes and ACTIVE rental extensions. ACTIVE rentals support the approved extension flow; do not introduce automatic early-return refunds.
- The accepted additional-payment deadline is ten minutes after owner approval. Confirm its current implementation and enforce deadlines on the server; a client countdown is presentation only.
- Keep accepted obligation, provider money movement, and booking/economic application as distinct durable stages. Preserve owner earnings and platform commission until the approved application stage.
- A successful refund may still await application or require financial recovery. Project those states honestly and refresh the authoritative booking after application.
- Expiration or withdrawal must release only the amendment's own holds/resources and preserve the underlying booking according to the approved lifecycle.

## Payments, refunds, and accounting

- Reuse the established provider abstraction. Inspect the adapter, contract tests, and current official provider documentation when provider semantics affect correctness.
- Never infer that a particular refund succeeded merely because its payment succeeded or because a refund request was attempted.
- Timeouts and UNKNOWN responses are uncertain outcomes. Preserve correlation identifiers and use provider-supported refund status retrieval, verified events, or the approved reconciliation/manual-resolution path.
- Do not blindly reissue uncertain money movement. Stable idempotency keys, durable operation records, and database constraints must prevent duplicate business effects across retries, callbacks, and workers.
- Cover provider success followed by local persistence failure. Recovery must prove the external outcome before finalizing or repeating the operation.
- Accepted refund entitlement comes from the accepted amendment snapshot. Do not invent a provider-age window or initiation deadline. A reconciliation grace period does not itself erase entitlement.
- Use existing money precision/currency conventions; never calculate financial amounts using unbounded floating-point arithmetic.
- Preserve ledger balance, immutable auditability, and explicit suspense/recovery accounting. Do not prematurely reverse owner/platform economics.
- Cancellation offsets must account for prior or pending amendment refunds according to the established authority so the renter is not refunded twice.
- Manual resolution must retain evidence, authorization, audit history, and the same accounting/idempotency guarantees as automated resolution.

## Database and migrations

- Inspect the current Prisma schema, migration history, and actual target database before diagnosing drift. Do not hard-code a historical migration count or next migration number.
- Add a new forward migration only when the task requires a schema change. Do not edit an applied migration, reset a database, drop data, or rewrite migration history to make verification pass.
- Distinguish development drift, test-schema omissions, historical failed attempts, and new regressions. Report unrelated drift without silently repairing it.
- Verify new constraints, defaults, indexes, backfills, and generated Prisma types. Include regression coverage when a migration enforces a business invariant.
- Use the configured test database for integration tests and confirm isolation from development/production data. Do not run destructive fixtures against an unverified target.

## Mobile and Admin UX

- Follow existing navigation, form, loading, validation, error, accessibility, and responsive layout patterns.
- Show current versus proposed booking details, totals, and the payable/refundable difference clearly where relevant.
- Use server statuses and reasons. Do not substitute optimistic success for pending payment, refund verification, application, or financial recovery.
- Avoid duplicate submissions and stale state after background completion or app resume. Use established centralized invalidation and authoritative refresh behavior.
- Keep internal implementation details out of product copy unless they help the user act. Support staff should receive actionable, permission-appropriate status and recovery controls.
- For reviews, preserve the established double-blind fourteen-day policy and publication guard requiring both moderation and publication status to be `PUBLISHED`.

## Verification

Read the current scripts; do not invent command names. The known comprehensive entry point is `pnpm verify`. Determine separately which integration suites and platform exports it includes.

- Run focused regression tests for the changed behavior, then the required project checks for a completed checkpoint.
- Verify formatting, lint, TypeScript, Prisma generation/validation, infrastructure validation, affected builds, and applicable API integration tests.
- Validate iOS and Android exports when mobile changes or checkpoint requirements call for them. Visually inspect changed screens when layout or interaction matters.
- Financial/lifecycle changes need meaningful coverage for duplicate requests/events, concurrent operations, stale state, worker retries, timeouts/UNKNOWN outcomes, and crash recovery, as relevant.
- Migration changes need appropriate schema/constraint and integration verification against the configured test database.
- Run `git diff --check` and inspect the final diff and worktree. Exclude build output, screenshots, logs, coverage, dumps, secrets, and temporary artifacts from commits.
- A reproducible timeout is a failed check even when no assertion failed. Diagnose it; do not mark the checkpoint green or raise the timeout merely to hide a race or delay.
- Distinguish checks run successfully, checks failed, and checks not run. Never claim full verification based on a focused rerun alone.

## Checkpoints and delivery

- Commit or stage only when the current task authorizes it. Use explicit task-owned paths rather than `git add .` in a mixed worktree.
- Preserve protected/pre-existing changes unstaged unless explicitly included by the user. Inspect the staged diff before committing.
- Do not deploy, push, publish, operate live payment flows, or mutate production data unless the task authorizes that action.
- Report the resulting behavior, changed areas, verification results, and any remaining blocker concisely. Include the commit hash when a checkpoint was created.
- Update the relevant handoff/decision document when the task changes an accepted contract or architectural rule. Keep transient audit numbers and current phase blockers out of this durable guide.
