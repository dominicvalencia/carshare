# ADR 0011: Platform-controlled late returns and booking extensions

- Status: Accepted for Phase 12 pilot architecture
- Date: 2026-08-29

## Context

Late returns affect renters, owners, succeeding bookings, occupancy, payments, ledger entries, and
claims. Philippine services use materially different rules. DOON currently documents a one-hour
grace period followed by PHP 1,000 per hour and an 80% host share. myTOYOTA Drive PH documents PHP
7 per minute plus a two-hour rental-rate charge when the next member is affected, and permits an
extension only when the vehicle is available. Hertz Philippines asks renters to communicate late
returns or extensions in advance and applies its daily rack rate to unadvised extensions. These are
market references, not pricing copied into this platform.

## Decision

Late-return rules are platform-controlled, versioned policy—not owner-entered penalties. The
existing authoritative `BookingUsageSummary` records scheduled return, actual handover return, and
late duration. The existing versioned `ClaimPolicy` and `ClaimCalculation` architecture is the only
place a pilot late-return amount may be calculated. Owners may submit evidence/claims, but cannot
choose the amount. Collection remains a separate additional-charge/payment state and must never be
represented as charged until a certified provider operation succeeds. Ledger posting follows that
financial state rather than the owner claim.

The first production policy must be configured after product, legal, and finance review. It must
define grace minutes, time unit/rate, cap or day-rate escalation, succeeding-booking impact, and
host/platform allocation. No competitor rate is a permanent default.

An extension is a separate server-authoritative request with requested end time, requester, reason,
owner decision where required, decision timestamps, and idempotency key. Approval must lock the
booking and vehicle occupancy, reject overlaps with active booking/owner-block occupancy, update the
authoritative booking end and occupancy atomically, append booking history/outbox events, and retain
the original scheduled end in the booking snapshot/audit trail. Rejection or expiration changes no
booking or occupancy time.

## Phase 12 pilot boundary

Late duration and claim calculation are already authoritative and auditable. Automated incidental
card collection is not certified and remains disabled. The extension command/API and admin policy
configuration UI are intentionally not presented as available until their transactional workflow,
provider behavior, legal wording, and end-to-end tests are implemented. Until then, support can
coordinate operationally but cannot mutate the schedule or impose an arbitrary fee.

## Consequences

- Renters receive predictable marketplace rules disclosed before booking.
- Owners cannot manufacture penalties.
- Financial evidence, payment state, and ledger state remain distinct and auditable.
- Extension delivery requires a dedicated Phase 12 follow-up migration and workflow; it must not be
  simulated with direct booking-date edits.
