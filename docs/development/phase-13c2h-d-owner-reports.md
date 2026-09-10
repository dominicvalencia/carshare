# Phase 13C-2H-D — Owner Reports

## D1 audit and design

D1 established that the first Reports release should be analytical rather than operational and should begin with immutable event-backed Marketplace Performance. Utilization, historical supply, geography, rankings, risk/quality, exports, and named Owner reporting remain deferred until their historical or privacy contracts are authoritative.

## D2 Marketplace Performance API core

D2 introduces `owner-marketplace-reports-v1` at `GET /api/v1/admin/owner/reports/marketplace`. It is backend-only: no Reports UI or trend endpoint is included. The endpoint reuses the Owner reporting period resolver for Manila Today, This Week, This Month, and custom periods up to 366 calendar days.

Period activity contains Bookings Created, first Confirmed Bookings, first Rentals Started, first Completed Rentals, Cancellation events, first renter-role assignments, new Owner profiles, new vehicles, and Active Renters During Period. Active Renter During Period is the distinct renter count with a persisted `CONFIRMED`, `ACTIVE`, `RETURNED`, or `COMPLETED` transition during the period.

Booking Confirmation Conversion and Booking Cohort Cancellation Rate use the booking-created cohort. Outcomes are evaluated through response `generatedAt`, so each is explicitly `cohortToDate`. No maturity cutoff or previous-period rate comparison is applied. Recent cohorts may be less mature and a future product refinement must address that without silently changing this versioned definition.

Active Rentals Now and Approved Listings Now are current-state values and remain structurally separate from period activity. Approved Listings Now counts current lifecycle status `APPROVED`; it is not a historical fleet or public-discoverability claim.

The rentals-started metric remains the first ACTIVE transition. Aggregate integrity metadata cross-checks it against `actualPickupAt`, allowing one second for the normal sequential persistence of the booking and history row, and independently checks cancellation record/status-history consistency. Material disagreement is reported as `REVIEW_REQUIRED` without exposing record identifiers or substituting another definition. Cancellation breakdowns expose actor type, reason code, and count only.

Financial metrics remain in `owner-revenue-v1` and `owner-revenue-trends-v1`. Active Vehicle Owner, utilization, historical supply, geography, rankings, ratings, claims/disputes/incidents, exports, D3 marketplace trends, and the Reports UI are not part of D2.

The endpoint is aggregate-only and explicitly labelled with environment and synthetic-data metadata. Access remains OWNER-only; SUPER_ADMIN, STAFF, and unauthenticated callers do not receive Owner executive reporting access.

## D2 review checklist

1. Verify Manila period and custom-range validation remain shared with Owner analytics.
2. Reconcile all period event counts against their timestamped source records.
3. Verify lifecycle retries are deduplicated through first-transition grouping.
4. Verify first renter-role assignment differs from account creation where applicable.
5. Verify cohort outcomes may occur after the selected period but not after `generatedAt`.
6. Verify zero-denominator rates are `null` and rate arithmetic does not use floating point.
7. Verify point-in-time values have no comparison or trend fields.
8. Verify cancellation breakdowns exclude free text and identity.
9. Verify integrity metadata contains counts only.
10. Verify OWNER access and denial for every other administrative role.

## D3 Marketplace trend-series API core

D3 introduces `owner-marketplace-trends-v1` at
`GET /api/v1/admin/owner/reports/marketplace/trends`. It is an API-only additive
event series intended for a future Reports presentation; D3 does not add that
presentation or any chart.

The eight series preserve the D2 event authorities exactly: booking creation;
the first `CONFIRMED`, `ACTIVE`, and `COMPLETED` lifecycle transitions;
cancellation-record creation; the first RENTER role assignment; Owner-profile
creation; and vehicle creation. Repeated lifecycle or role events are collapsed
to the first qualifying event before bucket attribution. Current mutable status
and `actualPickupAt` are never substituted for historical events.

The server selects the established granularity: Today is hourly; This Week and
This Month are daily; custom periods through 31 calendar days are daily, 32–180
days are weekly, and 181–366 days are monthly. All bucket boundaries use
`Asia/Manila` calendar semantics and `[startInclusive, endExclusive)` intervals.
Every valid interval is returned, with a decimal-string `"0"` count when it has
no event.

Before returning, the server sums each of the eight series and compares it with
the corresponding `owner-marketplace-reports-v1` period metric for the same
request. Any mismatch fails closed with
`OWNER_MARKETPLACE_TRENDS_RECONCILIATION_FAILED`. The D2 rental-start integrity
result is carried forward as aggregate metadata; the first ACTIVE transition
remains authoritative and the one-second `actualPickupAt` material-difference
threshold remains an integrity check only.

Active Renters During Period is deliberately excluded because bucket-level
distinct renter populations are not additive. Confirmation and cancellation
conversion remain cohort-to-date metrics and require a separate cohort-series
design before they can be trended. Active Rentals Now and Approved Listings Now
are point-in-time values and cannot be reconstructed as historical series from
the current model. Cancellation actor/reason trends are also deferred; the D3
primary contract contains only total cancellations per bucket.

The response remains aggregate-only and environment/synthetic-data labelled.
It contains no identities, record identifiers, free text, location, evidence,
financial detail, provider reference, or audit payload. Access remains OWNER
only; general Admin or Finance Staff permissions do not imply Reports access.

Representative query plans for This Month and a 366-day custom interval must be
recorded during local acceptance. Indexes, caches, projections, materialized
views, and reporting jobs remain evidence-driven future decisions rather than
D3 defaults.

Local read-only acceptance measured the grouped trend query at 1.086 ms
execution (8.345 ms planning) for 30 daily This Month buckets and 0.656 ms
execution (0.689 ms planning) for 13 monthly buckets spanning the maximum
366-day custom interval. The representative This Month series reconciled to D2
at 4 bookings created, 3 confirmations, 3 rental starts, 2 completions, 0
cancellations, 10 new renters, 6 new vehicle owners, and 2 new vehicles. These
results do not justify a schema or caching change.
