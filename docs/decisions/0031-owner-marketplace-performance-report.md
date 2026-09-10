# ADR 0031: Owner marketplace performance report

Status: Proposed for Phase 13C-2H-D2 review

Definition version: `owner-marketplace-reports-v1`

## Decision

`GET /api/v1/admin/owner/reports/marketplace` is an aggregate-only, OWNER-only marketplace report. It reuses the accepted `Asia/Manila` period resolver and `[startInclusive, endExclusive)` boundaries for `TODAY`, `THIS_WEEK`, `THIS_MONTH`, and bounded `CUSTOM` periods. The browser must not reconstruct lifecycle activity, cohorts, or reporting boundaries.

Period activity uses immutable event timestamps: `Booking.createdAt`; the first persisted `BookingStatusHistory` transitions to `CONFIRMED`, `ACTIVE`, and `COMPLETED`; `BookingCancellation.createdAt`; the first renter-role `UserRole.assignedAt`; `OwnerProfile.createdAt`; and `Vehicle.createdAt`. Active Renter During Period is the distinct renter count for persisted `CONFIRMED`, `ACTIVE`, `RETURNED`, or `COMPLETED` transitions in the period. Current booking status is never substituted for historical activity.

The confirmation and cancellation rates are booking-created cohort-to-date metrics. Their cohort is all bookings created in the selected period. Outcomes are a first confirmation transition or cancellation record at or before `generatedAt`, even when the outcome happened after the selected period. Rates are deterministic decimal-string percentages, are `null` for an empty cohort, have no previous-period comparison, and apply no maturity cutoff.

Current Active Rentals and Approved Listings are point-in-time values as of `generatedAt`; they receive no period comparison or trend. Approved Listings means the current `Vehicle.status` is `APPROVED`. It does not claim historical discoverability or operational availability.

## Integrity and privacy

The response reports aggregate integrity counts for ACTIVE-transition/pickup and cancellation-record/status-history inconsistencies. An ACTIVE transition and `actualPickupAt` written by one workflow may differ by normal sequential-persistence latency; only divergence beyond one second is considered a timestamp mismatch. The report never substitutes mutable current state or another timestamp. Non-zero discrepancies produce `REVIEW_REQUIRED`; no private record identifiers are returned.

Cancellation breakdowns contain actor type, reason code, and count only. The response contains no user, owner, vehicle, or booking identity; free text; location; evidence; payment or payout detail; provider reference; or audit payload. Non-production responses remain explicitly synthetic.

Access remains exact: authenticated administrative `OWNER` is allowed; `SUPER_ADMIN`, `STAFF`, and unauthenticated callers are denied by the established access-token and Owner-only guards.

## Deliberately unavailable

Active Vehicle Owner, historical supply, utilization, geography, rankings, ratings, claims/disputes/incidents, exports, and financial metrics are excluded. Financial authority remains exclusively in `owner-revenue-v1` and `owner-revenue-trends-v1`. Cohort maturity policy is deferred.
