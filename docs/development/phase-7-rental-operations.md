# Phase 7 — Rental operations

## Configuration

```dotenv
PICKUP_WINDOW_EARLY_MINUTES=30
PICKUP_WINDOW_GRACE_MINUTES=60
PICKUP_VERIFICATION_TTL_MINUTES=10
PICKUP_VERIFICATION_MAX_ATTEMPTS=5
RENTAL_OPERATIONS_SWEEP_SECONDS=15
```

The API and worker validate the same settings. Pickup and claim deadlines are stored on the booking
and are not recalculated later from mutable configuration.

## Lifecycle and evidence

```text
CONFIRMED → READY_FOR_PICKUP
owner finalizes pickup inspection → renter acknowledges and receives OTP
owner verifies OTP → ACTIVE
either participant starts return → RETURN_PENDING
owner finalizes return inspection → renter agrees or disagrees → RETURNED
24-hour claim window + no blockers → COMPLETED
```

Each inspection requires front, rear, both sides, interior/dashboard, odometer, and fuel/SOC display
images. Upload them as `PRIVATE` or `SENSITIVE` through `/api/v1/files` before associating them with
an inspection. Evidence is available only to the booking participants and explicitly permissioned
operations staff.

Mileage, fuel, EV SOC, and lateness are measured facts. Phase 7 never creates an additional payment,
refund, ledger posting, payout, or available earning.

## Endpoints

```text
GET  /api/v1/bookings/:reference/rental
POST /api/v1/bookings/:reference/rental/pickup/confirm
POST /api/v1/bookings/:reference/rental/return/start
POST /api/v1/bookings/:reference/rental/return/confirm
POST /api/v1/bookings/:reference/rental/incidents

GET  /api/v1/owner/bookings/:reference/rental
POST /api/v1/owner/bookings/:reference/rental/pickup/inspection
POST /api/v1/owner/bookings/:reference/rental/pickup/verify
POST /api/v1/owner/bookings/:reference/rental/return/start
POST /api/v1/owner/bookings/:reference/rental/return/inspection
POST /api/v1/owner/bookings/:reference/rental/claims
POST /api/v1/owner/bookings/:reference/rental/incidents

GET  /api/v1/admin/rentals
GET  /api/v1/admin/rentals/:reference
POST /api/v1/admin/rentals/:reference/operational-hold
POST /api/v1/admin/rentals/incidents/:incidentId/status
```

## Workers

The idempotent rental-operations sweep opens pickup windows, emits one-time pickup/return/claim
reminders, escalates critical incidents, and completes eligible returned bookings. Database
functions use row locks and `SKIP LOCKED`; API requests remain correct without exact worker timing.

## Local verification

```bash
pnpm db:migrate:deploy
pnpm db:seed
pnpm test
pnpm test:integration
pnpm verify
```
