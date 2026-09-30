# Phase 6 — Payments, ledger, commission, and pending earnings

> Historical phase guide. For current amendment additional-payment, refund-suspense, provider
> uncertainty, and recovery authority, see
> [Payments, refunds, ledger, and payouts](../architecture/payments-refunds-ledger.md) and
> [Change Booking](../architecture/change-booking.md).

> Phase 12 pricing amendment: an authoritative quote may contain a negative `DURATION_DISCOUNT` line.
> Its discounted subtotal is copied into the immutable booking snapshot and is the commission basis;
> later policy changes cannot reprice the booking. See ADR-0022.

## Local provider

Local and test environments default to `PAYMENT_PROVIDER=fake`. It performs deterministic
authorization/capture/void actions through the same provider contract and database finalizers as a
real provider. `APP_ENV=production` rejects this configuration.

Maya requires merchant-approved authorization/capture capability plus API keys. Void/refund support
must separately reflect merchant enablement. Copy `.env.example`; never commit real keys.

## Lifecycle

```text
HOLD → AWAITING_PAYMENT → authorize → AWAITING_OWNER
AWAITING_OWNER → owner accepts → CAPTURE_PENDING → provider capture → CONFIRMED
AWAITING_OWNER → rejected/cancelled/expired → occupancy released → durable void → VOIDED
```

`CAPTURE_PENDING` cannot be ordinarily cancelled. Unknown provider results remain pending and the
worker retrieves provider truth with the original external reference. The worker runs payment and
webhook reconciliation alongside booking expiry and outbox dispatch.

## API surface

```text
POST /api/v1/bookings/:reference/payment/authorize   RENTER
GET  /api/v1/bookings/:reference/payment             RENTER
POST /api/v1/webhooks/maya                           Maya source network
GET  /api/v1/owner/earnings                          OWNER
GET  /api/v1/admin/finance/provider-capabilities     payments.read
GET  /api/v1/admin/finance/bookings/:reference       payments.read
GET  /api/v1/admin/finance/commission-rules          commissions.read
POST /api/v1/admin/finance/commission-rules          commissions.manage
POST /api/v1/admin/finance/commission-rules/:id/disable
```

The mobile application opens the provider-hosted action URL and then refreshes backend status. It
never treats the return redirect as success. Owner earnings are explicitly pending and have no
withdrawal control.

## Financial controls

- All amounts are bigint minor units in PostgreSQL and safe integer minor units at the API edge.
- Posted ledger rows are immutable and every transaction must balance per currency.
- Commission snapshots and rules are historical evidence, not mutable configuration overlays.
- Completed plus in-flight refunds cannot exceed captured funds, enforced under a payment-row lock.
- Rental payments and security deposits use separate payment purposes and records.
- `SECURITY_DEPOSIT_ENABLED=true` fails configuration until provider behavior is approved.

## Verification

```bash
pnpm db:migrate:deploy
pnpm db:seed
pnpm test
pnpm test:integration
pnpm lint
pnpm typecheck
pnpm build
```

Maya sandbox smoke tests require real sandbox credentials and merchant feature enablement; the
automated suite must not call Maya.
