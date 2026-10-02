# ADR-0033: Server-authoritative booking amendments and durable financial recovery

## Status

Accepted

## Decision

Change Booking is a durable amendment aggregate rather than an in-place edit. Preview is read-only;
submission persists immutable current/proposed snapshots, inventory holds, history, and outbox data in
one transaction. The original booking remains authoritative until application. PostgreSQL constraints
decide overlap, and only server policy decides pricing, timing, fulfillment, and transitions.

For PRE_TRIP changes, the proposal may move both the scheduled pickup and return as one coherent
range. Preview validates the complete proposed occupancy, duration, immutable pricing authority, and
current fulfillment policy; application atomically replaces the canonical booking range and occupancy.
ACTIVE changes keep the pickup immutable and permit only an eligible return extension.

The booking read model projects allowed start/end fulfillment methods separately from lifecycle
changeability. Mobile renders a single method as read-only and offers a selector only when multiple
methods are both supported and changeable. A historically booked method remains represented even if
the latest vehicle policy no longer advertises it; preview remains the final serviceability authority.

Refundability continues to use the original captured-payment timestamp and original scheduled pickup
authority. Moving a proposed pickup does not rewrite that immutable cancellation/amendment timing
clock.

Owner response, renter additional-payment deadline, and provider reconciliation are distinct clocks.
Additional payment uses a dedicated ten-minute policy. Unknown provider outcomes remain reconcilable
instead of being treated as failure. Refund obligations are recorded through refund payable and
amendment refund suspense. Captured active extensions that cannot apply enter durable financial
recovery. Manual resolution requires audited authoritative evidence.

## Consequences

The workflow needs amendment snapshots, settlement/history/hold records, worker reconciliation, Admin
diagnostics, and strict idempotency. This is more state than directly editing a booking, but prevents
inventory, payment, refund, payout, and cancellation races from silently losing money or authority.
See [Change Booking architecture](../architecture/change-booking.md).
