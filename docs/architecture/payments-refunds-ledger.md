# Payments, refunds, ledger, and payouts

## Authority boundaries

`Payment` is the aggregate financial state; `PaymentOperation` is one provider command or retrieval;
`Refund` is a durable refund obligation/execution. Provider responses and webhooks are evidence, not
permission for a client to assign state. Definitive success/failure is recorded transactionally.
Uncertain outcomes use `UNKNOWN`, stable provider/idempotency references, `reconciliationRequired`,
`reconcileAfter`, and `unknownExpiresAt`. Retrying must retrieve/reconcile before risking duplicate
money movement.

Provider idempotency keys and request references identify an operation across retries; local workflow
status is not a substitute for provider truth. `PaymentPurpose` is `RENTAL`, `SECURITY_DEPOSIT`, or
`ADDITIONAL_CHARGE` (security deposits remain disabled by product policy). Payments support rental
authorization/capture/void and amendment additional charges. Refunds may arise
from cancellation, claims resolution, or accepted amendments. Fake providers are deterministic local
and test adapters only; they are not production certification.

A refund is correlated to its original `Payment`, currency, amount, and provider operation. Partial
refunds accumulate without exceeding captured value. Refund entitlement (what the domain owes) is
durable even if the provider's immediate execution/replay window closes; operational expiry therefore
moves unresolved work into financial recovery rather than deleting the obligation. Automated retrieval
and corroborated provider totals are preferred. Audited manual evidence is the final supported path
when provider automation cannot establish truth. Unique correlations, row locks, idempotent provider
references, and unique ledger sources enforce exactly-once effects.

## Ledger conventions

All values are integer minor units and every posted transaction balances to zero by currency. Positive
and negative entry signs express the repository's debit/credit convention; posted history is immutable.
Core accounts are `PAYMENT_PROVIDER_RECEIVABLE`, `CUSTOMER_FUNDS_HELD`, `OWNER_PAYABLE`,
`PLATFORM_COMMISSION_REVENUE`, `REFUND_PAYABLE`, `AMENDMENT_REFUND_SUSPENSE`, payout clearing/cash/fee,
and owner-penalty/cancellation-revenue accounts.

An amendment additional-payment capture debits provider receivable and credits customer funds held.
Application clears held funds and recognizes the owner/commission deltas. For a pre-trip amendment
refund, obligation recognition debits amendment refund suspense and credits refund payable; provider
settlement debits refund payable and credits provider receivable; application clears refund suspense
while applying owner/commission deltas. An unapplied captured active extension recognizes its refund
from customer funds held. Unique source/type/currency keys make repeated processing idempotent.

Owner earnings retain immutable capture evidence. Amendments change the payout-facing total through
`adjustmentAmountMinor`; they do not rewrite the original capture. Payout eligibility remains blocked
by incomplete booking/claim windows, disputes, held earnings, unresolved payment/refund reconciliation,
and amendment financial recovery. Cancellation owner penalties are separate obligations recovered via
future eligible payout adjustments; cards/bank accounts are not charged directly by that mechanism.

`OwnerEarningStatus` is `PENDING`, `HELD`, `AVAILABLE`, `PAID`, or `REVERSED`. Applied amendment
economics become payout-visible through the earning adjustment in the same atomic application; pending
or recovery amendments cannot leak proposed economics into payout.

See [Change Booking](change-booking.md), [booking cancellation](booking-lifecycle-and-cancellation.md),
the [manual reconciliation runbook](../development/manual-amendment-refund-reconciliation.md), and the
historical [Phase 6](../development/phase-6-payments-ledger.md) and
[Phase 9](../development/phase-9-owner-payouts.md) guides.
