# ADR-0014: Controlled claims, additional charges, and earning release

## Status

Accepted for Phase 8.

## Decision

Post-return claims are controlled workflows, not owner-created invoices. Claim workflow state is
kept separate from immutable adjudication outcomes:

```text
DRAFT → SUBMITTED → RENTER_REVIEW → UNDER_ADMIN_REVIEW → PAYMENT_PENDING → RESOLVED
                         ↘ WITHDRAWN
```

An adjudication records `APPROVED`, `PARTIALLY_APPROVED`, `REJECTED`,
`REQUEST_MORE_EVIDENCE`, or `ESCALATED_TO_DISPUTE`. A dispute has its own lifecycle and never
changes the booking to a synthetic disputed status.

Excess mileage uses whole excess kilometres and the rate in the immutable booking pricing
snapshot. Late return uses a versioned 30-minute grace period, ceiling-to-hour rate of one
twenty-fourth of the snapshotted daily rate, and a daily-rate cap. Fuel and EV deficiencies retain
their measured basis points, but MVP monetary valuation is an admin-entered platform amount within
a versioned category cap. Cleaning, damage, and other claims use the same constrained admin
valuation model and require evidence where applicable. Owners never submit charge amounts.

Every approved charge contains immutable calculation-backed lines and is collected through the
existing payment abstraction. The MVP collection strategy is explicit renter authorization.
Security-deposit utilization and off-session collection remain disabled because current provider
capabilities are not certified for them. All MVP category policies allocate 100% of a collected
claim charge to owner compensation and 0% to the platform; the basis-point snapshot remains
configurable per category and version.

Formula exposure holds the known amount plus a 10% safety margin. Evidence-based, damage, fuel,
EV, and unknown exposure holds the full earning. Holds lock the owner earning row and may be
partial. Collected charges and refunds post balanced immutable ledger transactions; zero-value
allocation entries are never written.

A returned booking completes only after its stored claim deadline and after all blocking claims,
disputes, incidents, and operational holds resolve. `availableAt` is stored as 24 hours after
booking completion or final financial resolution, whichever is later. A worker transitions an
eligible earning from `PENDING` to `AVAILABLE`; PostgreSQL prevents release when a committed hold
or another financial/operational blocker exists. Phase 8 does not create payout records or expose a
payout action.

## Consequences

- Claim, dispute, booking, payment, refund, and earning state machines remain independent.
- Original evidence, calculations, adjudications, charge lines, ledger entries, and usage facts are
  append-only or immutable.
- Payment callbacks, retries, and concurrent renter requests converge on one charge, one payment,
  and one financial posting.
- Phase 9 may consume only `AVAILABLE` earnings when it introduces payout eligibility and payout
  execution.
