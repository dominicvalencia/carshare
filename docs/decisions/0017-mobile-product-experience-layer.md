# ADR 0017: Mobile product experience and development location resolver

Status: Accepted (Phase 11)

## Context

The single React Native binary already exposed the Phase 1–10 capabilities, but screen-local styling,
raw transport fields, and a persistent mode toggle made backend concepts visible to end users. The
redesign must improve presentation without making the mobile client authoritative for availability,
pricing, booking, payment, rental, claim, or financial decisions.

## Decision

- The mobile application has a shared token and primitive layer for safe-area screens, typography,
  controls, cards, state views, status badges, imagery, and native date/time selection.
- Compact renter and owner bottom navigation remains mode-specific. Secondary workflows live in a
  native stack, and mode switching lives in Profile/Owner More instead of a global header.
- Location input is a presentation abstraction. The development implementation resolves curated
  Philippine area choices, or foreground device location with explicit permission, into coordinates
  used only in API requests. Coordinates are never presented as consumer form fields.
- Native selections are converted to ISO timestamps only at the API boundary. Local validation checks
  ordering and obvious input errors; PostgreSQL-backed server availability remains authoritative.
- API enums remain unchanged. A presentation mapper provides user-facing booking and operational copy.
- Public image grants remain the production source of vehicle imagery. An original repository-owned
  demo image provides a graceful local fallback and development seed asset.
- Development demo identities/listings are idempotent and clearly separate from integration fixtures.
  Test suites continue creating their own deterministic records.

## Consequences

Mobile screens can evolve coherently without duplicating domain rules. Deep secondary flows no longer
overload Profile or permanent tab bars. Development can demonstrate a credible marketplace without
third-party image licensing, while expiring grants and sensitive-file authorization remain unchanged.
