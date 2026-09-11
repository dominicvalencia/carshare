# Phase 13C-2K-B1 fulfillment domain and database foundation

Status: implementation candidate; physical/UI acceptance is outside this database/domain slice.

## Authority and scope

This phase establishes the self-drive booking fulfillment vocabulary and durable evidence needed by
later quote and booking work. A policy version independently enables rental-start methods (renter
pickup or owner delivery) and rental-end methods (renter return or owner collection). At least one
method on each side is mandatory.

Owner delivery and collection use one explicitly bounded service radius. The platform ceiling is
50,000 meters, fees are non-negative integer minor units (zero intentionally means free), and the
minimum-notice value is 0–10,080 minutes. These rules are enforced by shared application validation
and database checks. `VehiclePolicyVersion` remains immutable and is the policy authority.

`FulfillmentServiceabilityService` validates coordinates, loads the selected immutable policy, and
uses PostGIS geography `ST_Distance` from the private vehicle location. Radius boundaries are
inclusive. Browser/mobile distance estimates are never authoritative. Stable fail-closed reasons
distinguish unsupported methods, missing policy/radius, invalid destinations, insufficient notice,
and destinations outside the radius.

## Booking evidence and compatibility

`BookingFulfillmentSnapshot` is a one-to-one, append-only booking artifact containing the selected
start/end methods, structured service locations, authoritative distances, snapshotted fees/currency,
radius, notice, source policy version, and creation time. Exact addresses and coordinates are private
booking evidence and must not enter public vehicle/search projections.

Migration 42 intentionally creates no snapshot rows for existing bookings. A legacy booking without
a snapshot is projected as renter pickup plus renter return with zero fulfillment fees. This is a
compatibility interpretation, not fabricated persisted evidence.

Phase 13C-2K-B3 must require a complete immutable fulfillment snapshot for every newly created
booking before it is accepted. B1 does not change quote arithmetic, booking creation, owner
acceptance, lifecycle statuses, ledger/accounting behavior, or public discovery APIs.

## Deferred

- Quote selection and fulfillment price lines (B2)
- Booking creation and snapshot persistence (B3)
- Renter/Owner/Admin UI
- With-driver service
- Search filtering/ranking by fulfillment method
- Accounting recognition or payouts
- Public staging, providers, and production operations

No new cache, materialized view, projection table, or speculative index is introduced. The existing
latest-policy index and vehicle-location GiST geography index support this baseline.
