# ADR 0011: Authoritative booking holds and unified vehicle occupancy

- Status: Accepted
- Date: 2026-08-20

## Context

Phase 4 quotes and availability checks are advisory. Phase 5 must prevent two concurrent renters, or
an owner block and a renter, from committing overlapping use of one vehicle. The same design must
retain released history, preserve the exact quote and policy evidence, and extend into payment
authorization and capture in Phase 6 without inventing financial success in Phase 5.

## Decision

### Unified occupancy

`vehicle_occupancies` is the single database authority for owner blocks, booking reservations, and
future maintenance occupancy. Domain records keep their own metadata and reference one occupancy.
Every active row participates in one partial GiST exclusion constraint:

```sql
EXCLUDE USING GIST (vehicle_id WITH =, occupied_period WITH &&)
WHERE (active)
```

`occupied_period` is a generated `tstzrange` with `[start,end)` semantics. Booking occupancy ends at
`rental_end + snapshotted_turnaround_minutes`; an adjacent booking starting at exactly that end is
valid. Released rows remain immutable history but no longer block.

A database trigger verifies that a booking reservation uses the same vehicle as its booking and that
temporary active reservation states have an expiration timestamp. Owner block creation and booking
creation both insert into this table, so their race is resolved by PostgreSQL rather than a
check-then-insert window.

### Hold transaction and quote conversion

Hold creation requires the authenticated renter's unexpired Phase 4 `quoteId` and an
`Idempotency-Key`. A `SERIALIZABLE` transaction expires stale holds, validates/reuses the scoped
idempotency record, loads the quote, rechecks public and weekly eligibility, validates duration and
pricing integrity, prevents owner self-rental, and inserts the booking, immutable pricing and policy
snapshots, occupancy, initial history, idempotency result, and outbox event.

The exact immutable policy referenced by an unexpired quote remains valid even if a newer policy now
exists. Operational eligibility and conflicts are always rechecked. The client cannot submit prices
or authoritative policy values.

### State machine and funding boundary

The schema reserves the approved future states, while Phase 5 production can reach only:

```text
HOLD -> AWAITING_PAYMENT
HOLD | AWAITING_PAYMENT | AWAITING_OWNER -> CANCELLED
HOLD | AWAITING_PAYMENT | AWAITING_OWNER -> EXPIRED
```

Owner-request mechanics are testable only through a non-production development funding gate:

```text
AWAITING_PAYMENT -> AWAITING_OWNER
AWAITING_OWNER -> CAPTURE_PENDING        (owner accepts)
AWAITING_OWNER -> CANCELLED              (owner rejects)
```

Acceptance stops at `CAPTURE_PENDING`. Nothing creates payment, deposit, ledger, commission,
earning, payout, refund, or confirmation records. Production leaves the funding gate disabled.

Every command locks its booking row and validates the current state. Each transition appends status
history and writes its outbox event in the same transaction. Controllers never assign arbitrary
states.

### Expiration and outbox

PostgreSQL timestamps are authoritative. `expire_stale_bookings()` selects eligible rows with
`FOR UPDATE SKIP LOCKED`, conditionally transitions them, releases occupancy, and appends history and
outbox work atomically. It is called on availability-sensitive API paths, so a delayed worker cannot
leave expired inventory blocked. BullMQ runs proactive expiration every 15 seconds.

The worker polls committed outbox records with `FOR UPDATE SKIP LOCKED`, publishes idempotent BullMQ
jobs using the outbox UUID as the job ID, and records dispatch attempts. Notification delivery is
deferred.

### Idempotency and references

Idempotency is scoped by actor, operation, and key, with a request hash and retained booking result.
Same-key/same-payload concurrent retries converge on one booking. Reusing a key for a different quote
is rejected. A quote can produce at most one booking. Renter-facing references use a random
`CR-YYYY-XXXXXXXX` form; internal UUIDs remain separate.

## Consequences

- PostgreSQL, not advisory search state or Redis, decides inventory conflicts.
- The same exclusion constraint protects both directions of owner-block/booking races.
- Immutable booking evidence survives later owner policy changes.
- Phase 6 can implement authorization, owner request, capture, and confirmation through the funding
  abstraction and explicit transitions without redesigning occupancy.
- Supporting databases must provide PostgreSQL range types, `btree_gist`, triggers, and row locking.
