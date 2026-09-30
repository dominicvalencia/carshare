# ADR-0033: Server-authoritative booking amendments and durable financial recovery

## Status

Accepted

## Decision

Change Booking is a durable amendment aggregate rather than an in-place edit. Preview is read-only;
submission persists immutable current/proposed snapshots, inventory holds, history, and outbox data in
one transaction. The original booking remains authoritative until application. PostgreSQL constraints
decide overlap, and only server policy decides pricing, timing, fulfillment, and transitions.

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
