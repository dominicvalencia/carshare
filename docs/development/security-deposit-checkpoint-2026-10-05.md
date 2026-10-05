# Security Deposit checkpoint — 2026-10-05

Checkpoint captured on 2026-10-05 (Asia/Manila) while Maya support/account-owner confirmation is
pending.

## Repository position

- Branch: `main`
- HEAD: `181878fff3e8de16bfa94f8263cae84acd168a0c`
- Worktree: intentionally dirty with broad pre-existing application, test, migration, tooling, and
  documentation changes. The Security Deposit implementation is not represented by HEAD alone.
- This checkpoint is documentation-only. Nothing was staged, committed, pushed, deployed, or sent
  to Maya while creating it.

Future work must inspect `git status --short` and the complete relevant diffs before editing. In
particular, do not overwrite the existing changes to
`apps/mobile/src/navigation/deep-link-state.test.ts` or
`packages/database/prisma/development-demo.ts`.

## Completed milestones in the worktree

1. Security Deposit policy snapshot and authorization architecture.
2. Durable reminder scheduling with eligibility revalidation, amended-handover-safe stable keys,
   and suppression after satisfaction or booking ineligibility.
3. Phase 4 settlement architecture and domain/database foundation:
   `SecurityDepositSettlement`, `SecurityDepositSettlementItem`,
   `SecurityDepositSettlementLeg`, the settlement state machine, immutable snapshots, payout
   gating, renter/owner/admin read projections, and a provider execution kill switch.
4. Provider evidence and recovery foundation: `PaymentOperationEvidence`, webhook remapping,
   evidence-driven reconciliation, manual review, and persistent payout blockers.
5. A reusable Maya certification runner with safety guards, dry-run support, sanitized artifacts,
   and isolated scenarios for authorization, retrieval, void, capture, request-reference recovery,
   timeout/idempotency, webhook correlation, expiry, and reversal.

The accepted reminder thresholds are:

- 48 hours before handover
- 24 hours before handover
- 6 hours before handover

Known discrepancy: `apps/workers/src/security-deposit-reminders.ts` currently evaluates the final
reminder at three hours. This checkpoint does not change implementation. Aligning that source and
its tests to the accepted six-hour threshold is required when implementation work resumes.

## Database and configuration

Relevant migrations introduced in the current worktree:

- `20261005130000_security_deposit_settlement_foundation`
- `20261005160000_payment_operation_evidence`

Do not edit these historical migration files. Confirm target-database migration status before any
future database work.

Safety-critical configuration:

```dotenv
SECURITY_DEPOSIT_SETTLEMENT_EXECUTION_ENABLED=false
PAYMENT_OPERATION_RECONCILIATION_MANUAL_REVIEW_ATTEMPTS=8
```

Certification switches and sandbox credentials are server-side local configuration. Never copy
keys into documentation, source, mobile/browser bundles, logs, or certification artifacts.
Production Security Deposit execution remains off.

## Provider truth rules

- `PaymentOperation` is the durable provider-operation authority.
- `PaymentOperationEvidence` classifies evidence as `EXACT`, `UNAMBIGUOUS_AGGREGATE`, `AMBIGUOUS`,
  `CONFLICTING`, or `INSUFFICIENT`.
- `UNKNOWN` is not `FAILED` and must never trigger a blind repeat of uncertain money movement.
- Webhooks may be remapped and used as evidence, but aggregate webhook data does not invent an
  operation identity or amount.
- Reconciliation must use the strongest supported exact or request-reference retrieval and verify
  amount, currency, identifiers, and sibling operations.
- Ambiguous, conflicting, or insufficient outcomes remain blocked and may require manual review.
- Owner payout remains gated while provider truth or settlement obligations are unresolved.

## Maya capability matrix

| Capability                                | Checkpoint position                           |
| ----------------------------------------- | --------------------------------------------- |
| Authorization hold                        | `UNPROVEN`                                    |
| Authorization retrieval                   | Supported by the integration where applicable |
| Request-reference retrieval               | Supported by the integration where applicable |
| Partial capture                           | `UNSUPPORTED`                                 |
| Multiple captures                         | `UNSUPPORTED`                                 |
| Security Deposit utilization              | `UNSUPPORTED`; disabled pending certification |
| Operation-specific retrieval              | `UNPROVEN`                                    |
| Idempotent replay after ambiguous timeout | `UNPROVEN`                                    |
| Authorization expiry lookup               | `UNPROVEN`                                    |
| Webhook operation identity                | `UNPROVEN`                                    |
| Webhook operation amount                  | `UNPROVEN`                                    |

Runtime capabilities must not be promoted automatically from configuration or an incomplete test.

## Current Maya blocker

The first live authorization-hold certification attempt used PHP 100 (`10000` minor units), passed
the runner's safety guards, and requested `PREAUTHORIZATION`. Maya rejected the request before
creating a payment:

- HTTP 401
- Maya error `K007`
- invalid key scope / provider entitlement issue
- no provider payment ID
- no provider operation ID

This is not a failed authorization hold. Authorization hold remains `UNPROVEN` because Maya created
no payment and supplied no PREAUTHORIZATION evidence. Do not describe K007 as proof that
PREAUTHORIZATION itself is unsupported.

Awaiting Maya/support/account-owner confirmation:

1. Is the sandbox application enabled for Maya Checkout?
2. Is card acceptance enabled?
3. Is Authorize (Hold) and Capture enabled?
4. Is PREAUTHORIZATION enabled and scoped for the public key?
5. Do the public and secret keys belong to the same sandbox application?
6. Must a new key pair be generated after enabling Auth/Hold/Capture?
7. What is the authorization hold duration and expiry behavior?
8. What operation-specific evidence exists for capture, void, reversal, and idempotency?

## Exact resume plan

After Maya confirms Auth/Hold/Capture and key scope, first re-read this checkpoint and inspect the
current worktree and configuration without exposing secrets. Then run only authorization:

```sh
pnpm maya:certify --dry-run --scenario=authorization --amount-minor=10000
pnpm maya:certify --scenario=authorization --amount-minor=10000 --confirm-execution
```

Stop after that single live scenario. PASS requires an actual authorization/hold, expected
authorized amount, zero captured amount, non-sale semantics, successful exact retrieval, and
consistent request-reference/provider recovery. If it fails or is inconclusive, stop. If it passes,
review the sanitized result before separately approving void and capture certification.

Do not automatically:

- run the full certification suite;
- certify void or capture in the same step;
- retry an UNKNOWN provider operation;
- promote capabilities from configuration or an incomplete response;
- enable Security Deposit utilization or settlement provider execution;
- change credentials, `.env`, production configuration, or production data;
- implement Phase 4 capture/settlement execution without a separately approved slice.

## Verification status

This checkpoint records architecture and worktree state; it does not certify the uncommitted
implementation. During this documentation-only task, no provider calls or application test suites
were run. Markdown formatting and `git diff --check` are the required checks. The full affected
test, TypeScript, lint, migration, API/worker, and platform verification status must be reassessed
from the current worktree before implementation resumes; do not infer it from this checkpoint.

## Resume checklist

- [ ] Read `AGENTS.md` and all relevant nested instructions.
- [ ] Inspect branch, HEAD, status, and complete Security Deposit diffs.
- [ ] Confirm Maya's written entitlement/key response.
- [ ] Confirm `SECURITY_DEPOSIT_SETTLEMENT_EXECUTION_ENABLED=false`.
- [ ] Confirm public/secret credentials belong to the same sandbox application without printing
      them.
- [ ] Correct and test the final reminder boundary from 3h to the accepted 6h policy.
- [ ] Run the authorization dry run.
- [ ] Run one explicitly approved live authorization scenario and stop.
- [ ] Require hold semantics, zero captured amount, exact retrieval, and reference recovery.
- [ ] Keep capability promotion and settlement execution behind separate review.
