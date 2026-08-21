# ADR-0013: Server-authoritative rental operations and immutable evidence

## Status

Accepted for Phase 7.

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

## Consequences

- Operational facts do not post money or create arbitrary charges.
- Inspection evidence remains private. Original evidence may retain capture metadata for integrity;
  no public derivative is produced. Any future broadly accessible derivative must strip EXIF and
  location metadata.
- Notifications are advisory outbox events; PostgreSQL state and timestamps remain authoritative.
- Phase 8 can adjudicate claims and additional charges without rewriting Phase 7 evidence.
