# ADR-0004: PostgreSQL and Redis authority boundaries

- Status: Accepted
- Date: 2026-08-19

## Decision

PostgreSQL is authoritative for identities, vehicles, reservations, bookings, payments, the
double-entry ledger, earnings, payouts, refunds, disputes, idempotency records, and audit history.
Redis supports ephemeral caches, rate limits, OTPs, queue coordination, and temporary acceleration.

## Consequences

Redis loss may degrade throughput but cannot erase authoritative marketplace or financial state.
Future booking overlap protection is enforced through PostgreSQL exclusion constraints.
