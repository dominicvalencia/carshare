# ADR 0032: Owner marketplace trend series

Status: Proposed for Phase 13C-2H-D3 review

Definition version: `owner-marketplace-trends-v1`

## Decision

`GET /api/v1/admin/owner/reports/marketplace/trends` provides continuous,
server-generated marketplace event buckets for future Owner Reports charts.
The server owns period validation, `Asia/Manila` boundaries, granularity,
zero-filling, first-event deduplication, and summary reconciliation.

The contract includes only additive event-backed counts: Bookings Created,
Confirmed Bookings, Rentals Started, Completed Rentals, Cancellations, New
Renters, New Vehicle Owners, and New Vehicles. Their timestamps and
first-event rules are identical to `owner-marketplace-reports-v1`. Each point
contains an inclusive start, exclusive end, and BigInt-safe decimal-string
count.

Today uses hourly buckets. This Week, This Month, and custom periods through 31
calendar days use daily buckets. Custom periods of 32–180 days use weekly
buckets; custom periods of 181–366 days use monthly buckets. A final weekly or
monthly bucket may be shorter at the requested end boundary. Missing activity
is represented by an explicit zero bucket.

Each series total must equal the directly corresponding period metric returned
by `owner-marketplace-reports-v1` for the same request. A mismatch is an
integrity failure and the trend response fails closed rather than returning a
plausible but inconsistent visualization source.

## Exclusions

Active Renters During Period is a distinct population over the whole interval;
the same renter can participate in more than one bucket, so its bucket counts
would not be additive. Confirmation and cancellation conversion are
cohort-to-date measures and cannot be derived safely by dividing daily events.
Active Rentals Now and Approved Listings Now are current state; historical
series would require authoritative as-of reconstruction. These metrics remain
in `owner-marketplace-reports-v1` and outside this trend contract.

Cancellation actor/reason series, finance, utilization, supply reconstruction,
geography, rankings, ratings, risk, claims, and exports are not included.

## Integrity, access, and privacy

The first ACTIVE transition remains the rental-start event. `actualPickupAt`
remains only the D2 aggregate integrity cross-check with its accepted one-second
material-difference threshold. No current booking status or alternative
timestamp replaces persisted event history.

The endpoint is OWNER-only under the existing access-token and Owner-only
guards. SUPER_ADMIN, STAFF, Finance Staff, and unauthenticated callers do not
gain access through general administrative permissions.

Output is aggregate-only and environment/synthetic-data labelled. It exposes no
renter, owner, vehicle, or booking identity; cancellation free text; address or
coordinate; KYC evidence; payment or payout detail; provider reference; or raw
audit payload.
