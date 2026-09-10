# ADR 0030: Owner revenue trend series

Status: Proposed for Phase 13C-2H-C3 physical acceptance

Definition version: `owner-revenue-trends-v1`

## Decision

`GET /api/v1/admin/owner/revenue/trends` returns server-generated, aggregate-only financial activity buckets for the same OWNER-only Manila reporting period accepted by `owner-revenue-v1`. Bucket boundaries are `[startInclusive, endExclusive)`, contain decimal-string minor-unit values, and are complete—including explicit zeroes—within each returned currency group. Currencies are never combined or converted.

The server selects hourly buckets for Today; daily buckets for This Week, This Month, and Custom ranges through 31 calendar days; weekly buckets for Custom ranges from 32 through 180 days; and monthly buckets for Custom ranges from 181 through 366 days. Calendar boundaries are resolved through the IANA `Asia/Manila` timezone, not fixed-offset arithmetic.

## Authoritative attribution

- Rental Collections use the first reconciled successful rental capture for a booking, attributed at `Payment.capturedAt`. Authorization-only, failed, voided, non-rental, reconciliation-required, and duplicate logical captures are excluded. Refunds are not subtracted.
- Gross Booking Value uses `BookingPricingSnapshot.totalMinor` for that first successful rental capture and is attributed at the capture timestamp. Refunds never rewrite historical GBV.
- CarShare Commission uses posted `PLATFORM_COMMISSION_REVENUE` ledger entries at `LedgerTransaction.postedAt`, including a reversal in the bucket where its signed ledger movement was posted. Reconciliation-required payment sources are excluded.
- Owner Earnings use persisted `OwnerEarning` total value—net earning plus additional compensation plus adjustment—at `OwnerEarning.createdAt`. The associated payment must not require reconciliation.
- Completed Refunds use `Refund.amountMinor` at `Refund.completedAt` when status is `COMPLETED`.
- Paid Payouts represent historical successful paid events at `Payout.paidAt`. A payout later reversed remains in the paid-event series; reversal activity is not silently netted into it and remains separately represented by the accepted payout lifecycle summary.

## Reconciliation and exclusions

For every returned currency and metric, the sum of bucket values must equal its directly equivalent `owner-revenue-v1` selected-period summary. The request fails closed if any total disagrees. A single parameterized grouped SQL query aggregates the six event sources; the server adds missing zero buckets without loading raw financial records for browser-side grouping.

Owner Payable Liability, Available for Payout, Active Payout Allocations, and Processing Payouts remain uncharted point-in-time states. Historical as-of reconstruction would require a separate authoritative design. The response never exposes identities, bookings, payout destinations, instruments, provider references, ledger rows, audit payloads, or credentials.
