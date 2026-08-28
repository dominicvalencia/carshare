# ADR 0018: renter verification and rental eligibility

- Status: accepted
- Date: 2026-08-25
- Scope: Phase 12 pilot stabilization

## Decision

Pricing and public vehicle discovery remain available before renter verification. Creating a booking
hold and authorizing rental payment require an authoritative server-side rental-eligibility check.
The check runs again before an authorized payment can move a booking to the owner request queue.

Eligibility requires an active account, verified email, verified Philippine mobile number, approved
identity verification, and an approved, unexpired driver license. The renter case lifecycle is:

```text
DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED
                  ↘ MORE_INFORMATION_REQUIRED → DRAFT
                  ↘ REJECTED
APPROVED → SUSPENDED
```

Identity and driver-license records remain separate internally. An authorized decision changes both
parts of the renter case together so the public eligibility projection cannot become half-approved.

## Authorization and privacy

- Renters can update only their own profile and attach only sensitive files they uploaded.
- Required documents are jurisdiction-configured records, not hard-coded mobile constants.
- Only ADMIN/SUPER_ADMIN users with dedicated renter-verification permissions may access the review
  queue, protected evidence, or decision endpoints. SUPPORT and vehicle owners do not receive those
  permissions.
- Owners receive a purpose-limited trust projection: display name, account standing, member date,
  verification flags, completed rentals, and published rating aggregates. They never receive legal
  identity fields, license number/hash, address, emergency contact, document metadata, or evidence.
- Sensitive file access is object-authorized and short-lived. Object keys and permanent storage URLs
  are never returned. Access-grant issuance and direct evidence reads are audited.
- Verification state changes create administrative audit logs and security events.

## Data handling and retention boundary

Original measurements and evidence versions are preserved for audit and dispute integrity. Replaced
documents are marked as replaced rather than silently overwritten. The pilot does not introduce an
automatic destructive retention job: legal retention duration, deletion exceptions for active claims,
and data-subject erasure procedures require Philippine privacy/legal approval before production launch.
Until that policy exists, access minimization, encryption/storage controls, and audited retrieval are
mandatory, and operations must not perform ad-hoc deletion.

## Consequences

- A failed eligibility check creates no booking, occupancy, pricing snapshot, payment, or owner-visible
  request.
- A verification suspension between authorization initiation and finalization voids/releases the
  authorization through the existing controlled payment path.
- Search and quote responses are not proof that a renter may reserve.
- Provider-backed automated KYC can replace manual review later without changing booking authority.
