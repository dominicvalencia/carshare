# ADR-0006: locked MVP operating decisions

- Status: Accepted
- Date: 2026-08-19

## Decision

- Launch jurisdiction: Philippines
- Currency: PHP only
- Post-return claim window: 24 hours
- Earning safety hold: 24 hours after the claim window closes or all claims resolve, whichever is later
- Default vehicle turnaround: 2 hours; owners may choose larger approved presets
- Mileage allowance uses the booking snapshot's chargeable-day count
- Mileage overages bill whole kilometers while original inspection measurements remain preserved
- Fuel, EV deficiency, and all other additional charges require administrator approval during MVP
- Owner onboarding begins immediately; protected operations require a verified owner profile
- One mobile application uses compact renter and owner navigation

Normal settlement is return, 24-hour claim window, booking completion, 24-hour earning safety hold,
earning availability, approved payout batch, then provider-confirmed payment. Relevant earnings remain
held while claims or disputes are unresolved.

Security deposits retain a separate provider abstraction and lifecycle. Authorization duration,
partial capture, release behavior, and provider implementation remain deliberately undecided until a
payment provider is selected.

## Consequences

These rules are architectural inputs for later phases. Philippines-specific regulatory, tax,
insurance, privacy, and payment conclusions still require qualified local review; this ADR does not
assert legal compliance.
