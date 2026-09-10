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
