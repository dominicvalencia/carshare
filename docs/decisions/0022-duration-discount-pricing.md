# ADR-0022: server-authoritative duration discounts in immutable pricing

- Status: Accepted (Phase 12 marketplace completeness)
- Date: 2026-09-04

## Decision

An immutable vehicle policy version may configure optional 3-, 7-, 14-, and 30-day discount tiers in
integer basis points, capped at 4,000. Enabled tiers are non-decreasing; the longest applicable tier
wins and tiers do not stack. The server uses PHP integer minor-unit arithmetic and records a negative
`DURATION_DISCOUNT` line with explicit base, savings, tier, rate, and discounted subtotal fields.

Hold creation copies those fields into the append-only booking pricing snapshot. Commission is based
on that discounted subtotal. Future policy versions never reprice an existing quote or booking.

## Consequences

Clients may explain but cannot calculate authoritative savings. Signed pricing lines are allowed only
for the explicit discount code; other charge lines remain nonnegative. Extensions and active-rental
maintenance scheduling are separate future decisions.
