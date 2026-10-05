# Security Deposit Phase 4 settlement foundation

Phase 4 establishes the durable review, decision, execution, and recovery model for a required
security deposit. It does not enable provider settlement execution. The feature flag
`SECURITY_DEPOSIT_SETTLEMENT_EXECUTION_ENABLED` must remain `false` until provider capabilities are
certified and a separate activation decision is approved.

## Lifecycle and authority

The booking's immutable policy snapshot remains the requirement, amount, and currency authority.
The lifecycle is:

1. A booking snapshots whether a deposit is required and the approved server-owned tier.
2. The renter places a purpose-specific authorization during the eligible pre-handover window.
3. Durable reminders are scheduled for 48 hours, 24 hours, and 6 hours before handover and stop
   once the deposit is satisfied or the booking becomes ineligible.
4. Handover enforcement reads the current authorization state when execution is enabled.
5. Claims and rental evidence inform settlement review; they do not mutate the original deposit
   requirement or authorization evidence.
6. `SecurityDepositSettlement` records the review and decision, with immutable decision inputs and
   amount snapshots.
7. `SecurityDepositSettlementItem` records the approved itemized basis for any deduction.
8. `SecurityDepositSettlementLeg` links each capture or release obligation to its durable
   `PaymentOperation`.
9. Provider execution, when separately enabled in the future, advances only from an approved
   settlement decision and must reconcile uncertain outcomes before progressing.

Physical rental completion and financial settlement completion are distinct. The vehicle may be
physically returned while deposit settlement, reconciliation, or manual review remains open.
Payout eligibility stays blocked while a deposit obligation or its provider truth is unresolved.

## Settlement state and snapshots

Settlement decisions are versioned and append their authoritative inputs rather than rewriting
past evidence. The settlement captures the authorized amount, approved deduction, release amount,
currency, decision source, reason, approver, and timestamps. Item and leg records preserve how the
decision was decomposed and executed. Retries reuse the corresponding `PaymentOperation`; they do
not create a second business obligation.

The database foundation was introduced by:

- `20261005130000_security_deposit_settlement_foundation`
- `20261005160000_payment_operation_evidence`

These are forward migrations and must not be edited after application.

## Provider truth and recovery

`PaymentOperation` remains the authority for a provider operation. `PaymentOperationEvidence`
stores sanitized evidence gathered from exact operation responses, provider retrieval,
request-reference recovery, webhooks, and authorized manual review. Evidence attribution is one of:

- `EXACT`
- `UNAMBIGUOUS_AGGREGATE`
- `AMBIGUOUS`
- `CONFLICTING`
- `INSUFFICIENT`

`UNKNOWN` is not `FAILED`. An unknown capture, void, release, or refund is never blindly reissued.
The worker first remaps delayed webhooks, gathers the strongest provider evidence supported by the
adapter, and evaluates that evidence against the operation, amount, currency, references, and
sibling operations. Proven success or failure may advance the operation; ambiguity, conflict, or
insufficient evidence remains quarantined and can enter manual review. Payout blockers remain in
place until provider truth and the settlement obligation are resolved.

`PAYMENT_OPERATION_RECONCILIATION_MANUAL_REVIEW_ATTEMPTS` defaults to `8`. Reaching that threshold
does not reinterpret uncertainty as failure; it stops automatic retries and requires review.

## Provider capability boundary

The current Maya capability position is conservative:

| Capability                                | Current position                              |
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

Capabilities are promoted only from sanitized certification evidence and explicit review. A
successful HTTP response, redirect, aggregate webhook, or UI result is not sufficient evidence on
its own.

## Current Maya blocker

The first live authorization-hold certification attempt passed the local safety guards and sent a
PHP 100 (`10000` minor units) `PREAUTHORIZATION` Checkout request. Maya returned HTTP 401 with
`K007` before creating a payment. There is no provider payment ID or provider operation ID and
therefore no evidence yet with which to classify Maya's PREAUTHORIZATION semantics.

Maya documents `K007` as invalid key scope. Repository request construction uses the sandbox
`POST /checkout/v1/checkouts` endpoint, public-key authentication, and the PREAUTHORIZATION field.
The strongest current conclusion is a provider entitlement block, not proof that
PREAUTHORIZATION failed. Maya must confirm the sandbox application's Checkout, card acceptance,
Authorize (Hold) and Capture, key scope, and key-pair provisioning before certification resumes.

Settlement provider execution remains disabled while this blocker is open.
