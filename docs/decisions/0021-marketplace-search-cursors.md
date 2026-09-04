# ADR-0021: criteria-bound cursor pagination for marketplace search

- Status: Accepted (Phase 12 marketplace completeness)
- Date: 2026-09-04

## Decision

Public vehicle search returns 10 items by default and uses an opaque, versionable cursor rather than a
client offset. The cursor binds the complete normalized search criteria and stores the last item's
deterministic sort position, including vehicle ID as the final tie-breaker. The API rejects malformed
or criteria-mismatched cursors. Mobile infinite queries retain loaded pages and prevent duplicate
next-page requests; availability is revalidated authoritatively when quoting and booking.

PostGIS currently supplies a bounded set of at most 500 nearby candidates before centralized
eligibility/filtering and cursor slicing. Replacing that bound requires query-plan and inventory-scale
evidence, not a client pagination change.

## Consequences

Paging is stable and does not silently combine different searches. Vehicle ID prevents ambiguous equal
sort values. The opaque cursor may evolve without exposing database offsets or internal query details.
