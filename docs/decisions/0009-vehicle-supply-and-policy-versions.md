# ADR-0009: Vehicle lifecycle, spatial location, and immutable policy versions

- Status: accepted
- Date: 2026-08-20

## Context

Phase 3 must let verified owners prepare moderated vehicle supply without introducing public search,
bookings, quotes, or finance. Later booking decisions must be able to reconstruct the exact vehicle
policy used. Exact pickup coordinates and sensitive identifiers must not leak through future public
listing contracts.

## Decision

Vehicle approval and operational availability are independent state machines. Listing lifecycle is:

```text
DRAFT → PENDING_APPROVAL
PENDING_APPROVAL → APPROVED | CHANGES_REQUIRED | REJECTED
CHANGES_REQUIRED | REJECTED → PENDING_APPROVAL
APPROVED → SUSPENDED | ARCHIVED
SUSPENDED → APPROVED | ARCHIVED
```

All commands are explicit API operations and every transition creates append-only status history.
Operational state is independently `AVAILABLE`, `MAINTENANCE`, or `TEMPORARILY_UNAVAILABLE`.

Categories, features, and jurisdictional document definitions are platform-managed reference data.
EV is a powertrain, not a body category. Plate and VIN values are private; keyed normalized hashes
enforce uniqueness without putting raw identifiers into ordinary lookup paths or logs.

Vehicle location retains latitude/longitude for typed application writes and a generated PostGIS
`geography(Point,4326)` as the authoritative spatial search value. A GiST index prepares radius
search while no public location endpoint exists in Phase 3.

Pricing, mileage, fuel/EV return policy, turnaround, and weekly availability form one immutable
`VehiclePolicyVersion` aggregate. A configuration change inserts version `N+1`; database triggers
reject updates and deletes. Future bookings can reference/snapshot one exact aggregate version.

Weekly availability is whole-day for MVP. Booking-phase pickup/return scheduling will define time
windows. Owner blocks use half-open UTC ranges and a PostgreSQL exclusion constraint to prevent
overlap for the same vehicle.

Approved listings permit low-risk description, feature, policy, weekly availability, block, and
operational changes. Vehicle identity, specifications, documents, photos, and exact location are
locked until an administrator explicitly requests changes.

## Consequences

- Development and CI PostgreSQL must include PostGIS and `btree_gist`.
- Historical policy reconstruction does not depend on mutable current rows.
- Material approved-listing changes are deliberately conservative in MVP.
- Public projection and approximate-location contracts remain Phase 4 work.
