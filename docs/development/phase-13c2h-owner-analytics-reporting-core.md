# Phase 13C-2H-A — Authoritative Metric Contracts and Reporting Core

Status: **IMPLEMENTED / AUTOMATED VERIFICATION PASS / REVIEW REQUIRED**

Phase 13C-3 staging remains paused. This slice changes no Owner UI, creates no infrastructure,
contacts no provider, and introduces no database migration.

## API

`GET /api/v1/admin/owner/analytics/overview`

The endpoint requires an authenticated, active Admin identity whose exact Admin role is `OWNER`.
`SUPER_ADMIN`, `STAFF`, ordinary users, and unauthenticated callers are denied. This exact-role guard
is intentional because the legacy policy guard maps OWNER and SUPER_ADMIN to several shared Admin
role gates.

Query parameters:

- `period=TODAY|THIS_WEEK|THIS_MONTH|CUSTOM`
- `startDate=YYYY-MM-DD` and `endDate=YYYY-MM-DD` for `CUSTOM`

Custom dates are inclusive Manila calendar dates. The generated database interval remains
start-inclusive/end-exclusive. The maximum synchronous custom interval is 366 calendar days.

The response contains environment and synthetic-data classification, `Asia/Manila` boundaries,
comparison boundaries, generation time, and definition version `owner-analytics-v1`. Period metrics
include current/previous values, absolute change, percentage change, comparison availability, and
source classification. Metadata labels currency handling as `GROUPED_BY_CURRENCY`; currency values
remain separate and use minor-unit decimal strings.
`activeRentalsNow` is explicitly point-in-time.

## Financial integrity

Captured-rental GBV comes from immutable booking pricing snapshots and the first finalized rental
capture. Refunds never rewrite GBV. Completed refunds are reported separately. Recognized CarShare
commission comes from posted platform-commission ledger entries and follows the existing sign
convention. Capture-allocation ledger values are reconciled against immutable commission snapshots;
missing snapshots or disagreement stop the response safely.

The endpoint returns aggregate business data only. It exposes no KYC evidence, payment instrument,
pickup address, provider secret, payout destination, customer PII, or audit payload.

See [ADR 0028](../decisions/0028-owner-analytics-metric-contract.md) for canonical definitions and
known unavailable metrics.

## Deferred

- Owner dashboard replacement and charts (Phase 13C-2H-B or later)
- Cancellation rate and additional metrics
- CSV/PDF exports
- Materialized projections, Redis caching, or background reporting
- Speculative indexes without measured query-plan evidence
- True net platform revenue and unsupported financial fields
- Public staging and Phase 13C-3
