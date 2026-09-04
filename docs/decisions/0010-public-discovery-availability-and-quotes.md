# ADR 0010: Public discovery, advisory availability, and immutable quotes

- Status: Accepted
- Date: 2026-08-20
- Amendment: Phase 12 criteria-bound cursor pagination and duration discounts are specified by
  [ADR-0021](0021-marketplace-search-cursors.md) and [ADR-0022](0022-duration-discount-pricing.md).

## Context

Phase 4 introduces renter discovery without reservations or payments. Public APIs need exact internal coordinates for geographic search while preventing location, vehicle, owner, document, and storage metadata leakage. Pricing needs an auditable handoff to Phase 5.

## Decision

### Public projection and eligibility

Search and detail use explicit public projections and never serialize owner/admin records. One `PublicVehicleEligibilityService` is authoritative for search hydration, detail, favorites, quotes, and admin diagnostics. A vehicle must be approved, operationally available, owned by a verified owner, and have a location, immutable policy, ready public cover, and every required active Philippines document currently verified and unexpired.

### Location privacy

PostGIS retains exact coordinates and performs `ST_DWithin` and `ST_Distance`. Public contracts return only city, province, country, and distance rounded to 0.1 km. Phase 4 returns no coordinates or map marker. A later map product must introduce an explicitly derived/coarsened marker strategy first.

### Search and pagination

Search obtains a distance-ordered PostGIS candidate set capped at 500, then applies central eligibility and composable filters. Owner blocks are loaded once for all candidates when dates are present. Pages are capped at 50.

Cursors are opaque base64url tokens bound to the sort and last vehicle ID. The server rebuilds deterministic ordering and seeks after the ID; it never uses a large database offset. Tie breakers are always stable IDs:

- `DISTANCE`: distance, ID
- `PRICE_LOW_TO_HIGH`: price, distance, ID
- `PRICE_HIGH_TO_LOW`: reverse price, distance, ID
- `NEWEST`: approval time descending, distance, ID
- `RECOMMENDED`: distance, lower price, newer approval, ID

The recommended order is transparent and does not claim personalization. Reliability can be added when meaningful data exists.

### Advisory availability and duration

`AvailabilityService` is the Phase 5 extension point. It checks timezone-aware weekly policy, minimum/maximum chargeable duration, active owner blocks, and turnaround on both sides of blocks. It writes no booking or fake reservation rows. Every result warns that it does not reserve inventory.

`PHP_DAILY_24H_CEILING_V1` calculates `ceil((end - start) / 24 hours)`. Thus 23 hours is one chargeable day and 25 hours is two. The same persisted value drives base rent and included mileage.

### Pricing quote persistence

Only explicit authenticated renter quote requests are persisted; search estimates are not. Quotes and lines are append-only, reference the exact immutable policy version, use PHP integer minor units, expire after `QUOTE_TTL_MINUTES` (15 by default), and do not reserve a vehicle.

Phase 4 activates only `RENTAL_BASE`. It excludes taxes, service fees, discounts, promotions, commission, deposits, and payments. A policy change produces a new quote; the old quote remains reproducible and reports `CONFIGURATION_CHANGED`.

That sentence records the Phase 4 scope. Phase 12 now permits the explicit `DURATION_DISCOUNT` signed
line and immutable base/savings/discounted-subtotal snapshot described in ADR-0022; deposits remain
disabled.

### Caching and analytics

PostgreSQL stays authoritative. Availability and price are not cached. Redis only rate-limits explicit quote creation. Append-only analytics deliberately exclude precise search coordinates. Recently viewed remains session-local.

## Consequences

- Phase 5 can consume a valid quote and transactionally recheck availability without replacing these services.
- Public contract changes remain deliberate and privacy-reviewable.
- The 500-candidate MVP bound should be revisited with query-plan evidence as inventory grows.
