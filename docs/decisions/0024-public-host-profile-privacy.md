# ADR-0024: opaque public Host Profile and privacy boundary

- Status: Accepted (Phase 12 marketplace completeness)
- Date: 2026-09-04

## Decision

Renter-facing host navigation uses a unique opaque `OwnerProfile.publicReference`, not an internal
owner/user UUID. The explicit public projection may include display identity, verified-host state,
member/hosting tenure, completed-rental count, published host reputation/category aggregates, published
reviews, and currently eligible public vehicles.

It excludes legal/contact/address/KYC/payout data, internal identifiers, exact pickup coordinates,
private vehicle documents, storage keys, pending/unpublished review content, and Admin/security data.
Vehicle reviews and host reviews remain separate subjects and routes.

## Consequences

Public profile evolution must start from an allow-listed projection. Possession of the opaque reference
does not authorize private owner, file, vehicle, or operational APIs.
