# Phase 4 — Public discovery and pricing quotes

## Delivered API

```text
GET    /api/v1/vehicles/search
GET    /api/v1/vehicles/:vehicleId
GET    /api/v1/vehicles/:vehicleId/availability
POST   /api/v1/vehicles/:vehicleId/quotes       (RENTER)
GET    /api/v1/quotes/:quoteId                  (RENTER)
GET    /api/v1/favorites                        (RENTER)
PUT    /api/v1/favorites/:vehicleId             (RENTER)
DELETE /api/v1/favorites/:vehicleId             (RENTER)
GET    /api/v1/admin/vehicles/:vehicleId/public-visibility
```

Search accepts exact input latitude/longitude, a 1–100 km radius, optional timezone-qualified dates, category, make, model, transmission, powertrain, fuel type, minimum seats, integer-minor-unit price range, up to ten features, unlimited mileage, five deterministic sorts, an opaque cursor, and a maximum page size of 50.

## Environment

```text
QUOTE_TTL_MINUTES=15
```

The range is 5–60 minutes. Expiry never represents an inventory hold.

## Verification

```bash
pnpm db:migrate:deploy
pnpm db:generate
pnpm test
pnpm test:integration
pnpm lint
pnpm typecheck
pnpm build
```

The real PostgreSQL/PostGIS scenario covers distance ordering, filters, privacy, favorites, daily ceiling pricing, included mileage, immutable policy references, regenerated quotes, and turnaround-aware blocks. Phase 2–3 scenarios remain in the suite.

No booking, hold, payment, deposit, ledger, owner decision, rental handoff, dispute, messaging, or review workflow is introduced. A quote is a price explanation, not checkout or a reservation.
