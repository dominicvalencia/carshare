# ADR-0013: Server-authoritative rental operations and immutable evidence

## Status

Accepted for Phase 7; refined during Phase 12 pilot stabilization.

## Decision

Confirmed bookings progress independently of payment and earning states:

```text
CONFIRMED → READY_FOR_PICKUP → ACTIVE → RETURN_PENDING → RETURNED → COMPLETED
```

Pickup windows open 30 minutes before the scheduled start and close after a 60-minute grace
period. These configurable values are materialized on each booking. API commands evaluate the
timestamps even if a worker is delayed.

Pickup activation requires a finalized owner inspection, renter acknowledgement, owner
acknowledgement, and a consumed server-generated OTP. The OTP is six digits, HMAC-hashed,
booking-scoped, valid for ten minutes, single-use, and limited to five attempts.

Pickup and return use the same inspection aggregate. Measurements use odometer metres and
fuel/SOC basis points. Seven structured private images are required. Finalized inspections,
inspection media, confirmations, and usage summaries are protected from mutation at PostgreSQL.
Corrections append an amendment rather than replacing the original facts.

Return is explicitly two-party. The renter submits finalized return evidence as version 1. The owner
must then perform an independent receipt inspection, stored as a separate immutable participant
version, before agreeing with or disputing the renter's primary return record. Agreement advances the
locked booking exactly once to `RETURNED`; disagreement uses the existing dispute and earning-hold
path. Neither participant can enter a charge amount.

ICE and conventional hybrid vehicles require fuel. Battery-electric vehicles require SOC.
Plug-in hybrids require both. Return usage is computed by the server from the booking snapshots.
Whole travelled kilometres are used for mileage policy comparison while original metre readings
remain preserved.

`RETURNED` means possession ended and starts the snapshotted 24-hour claim window. Claims and the
completion worker lock the same booking row. Open claims, return disagreements, operational holds,
and unresolved blocking incidents prevent completion. Owner earnings remain `PENDING` even after
completion in this phase.

Early return never shortens occupancy. Late return attempts to extend occupancy through the actual
return plus the snapshotted turnaround buffer. A conflicting downstream reservation remains intact
and produces a critical operational incident.

Expected time is not proof of custody. Operational interpretation follows this rule:

```text
SCHEDULE provides expected timing.
PARTICIPANT HANDOVER confirms actual possession.
INSPECTION provides condition evidence.
ADMIN fallback resolves non-responsive parties.
```

Passing pickup or return deadlines never transitions custody automatically. Configured overdue jobs
notify both parties. Either party can create an operational incident. An administrator with
`rentals.intervene` may establish pickup or return only after reviewing evidence through a
reason-required, audited command. Administrative return resolution preserves renter evidence,
calculates usage server-side, opens the claim window, and updates occupancy using the same turnaround
rules as participant confirmation. It does not itself charge, cancel, or refund.

## Consequences

- Operational facts do not post money or create arbitrary charges.
- Inspection evidence remains private. Original evidence may retain capture metadata for integrity;
  no public derivative is produced. Any future broadly accessible derivative must strip EXIF and
  location metadata.
- Notifications are advisory outbox events; PostgreSQL state and timestamps remain authoritative.
- Multiple finalized inspection versions are allowed only when submitted by different booking
  participants; each participant/type combination remains unique and immutable.
- Phase 8 can adjudicate claims and additional charges without rewriting Phase 7 evidence.
