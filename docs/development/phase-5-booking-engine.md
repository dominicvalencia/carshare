# Phase 5 — Booking engine and concurrency control

> The development funding gate documented below was removed by Phase 6. See
> [Phase 6 payments and ledger](phase-6-payments-ledger.md) for the production lifecycle.
> This file records the Phase 5 delivery boundary; it is not the current end-to-end lifecycle. See the
> [current system baseline](../architecture/current-system-baseline.md) for the implemented Phase 12
> payment, pickup, return, claim-window, and completion transitions.

## Delivered lifecycle

Production supports authoritative `HOLD`, `AWAITING_PAYMENT`, cancellation, and expiration. The
development-only funding adapter can submit a request to an owner; acceptance stops at
`CAPTURE_PENDING`, and rejection releases inventory. `CONFIRMED` and every financial operation are
reserved for Phase 6 or later.

```text
Quote -> HOLD -> AWAITING_PAYMENT
             \-> CANCELLED | EXPIRED

Development/test only:
AWAITING_PAYMENT -> AWAITING_OWNER -> CAPTURE_PENDING
                                  \-> CANCELLED | EXPIRED
```

## API

```text
POST /api/v1/bookings                              RENTER, Idempotency-Key required
GET  /api/v1/bookings                              RENTER
GET  /api/v1/bookings/:reference                   RENTER owner-scoped projection
POST /api/v1/bookings/:reference/continue          RENTER
POST /api/v1/bookings/:reference/cancel            RENTER
POST /api/v1/bookings/:reference/development-funding-ready

GET  /api/v1/owner/bookings/requests               VERIFIED OWNER
GET  /api/v1/owner/bookings/:reference             VERIFIED OWNER
POST /api/v1/owner/bookings/:reference/accept      VERIFIED OWNER
POST /api/v1/owner/bookings/:reference/reject      VERIFIED OWNER

GET  /api/v1/admin/bookings                        vehicles.read
GET  /api/v1/admin/bookings/:reference             vehicles.read
```

The development funding endpoint returns a structured unavailable error in production. Booking
responses use explicit renter, owner, and admin projections. They do not expose private coordinates,
vehicle documents, VIN/plate, verification documents, storage keys, authentication material, or
payment data.

## Environment

```text
BOOKING_HOLD_TTL_MINUTES=10
OWNER_RESPONSE_TTL_MINUTES=60
BOOKING_FUNDING_MODE=disabled
```

`BOOKING_FUNDING_MODE=development` is accepted only outside production and exists solely to test
owner-domain transitions without claiming that funds were authorized.

## Database authority

`vehicle_occupancies.occupied_period` is a generated `[start,end)` range. One partial GiST exclusion
constraint covers active owner blocks and booking reservations. A booking occupancy includes the
turnaround minutes copied from its quote policy. Stale expiration is resolved inside PostgreSQL
before availability-sensitive inserts.

Booking pricing snapshots, pricing lines, policy snapshots, status history, cancellation records,
and owner decisions are protected by append-only triggers. State and outbox work commit together.

## Workers

- `expire-stale-bookings` runs every 15 seconds and invokes the locking PostgreSQL expiry function.
- `dispatch-outbox` runs every 5 seconds and forwards committed events to `domain-events` with the
  outbox ID as the idempotent job ID.

PostgreSQL deadlines remain authoritative when Redis or workers are unavailable.

## Verification

```bash
pnpm db:migrate:deploy
pnpm db:generate
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm db:validate
pnpm build
pnpm verify
```

The PostgreSQL integration suite includes 100 distinct authenticated renters competing for the same
vehicle and dates, same-key retries, exact turnaround boundaries, expiration/rebooking, cancellation,
immutable snapshots, owner self-rental prevention, operational mutation guards, owner-block/booking
races in both orders, and safe owner-decision mechanics.
