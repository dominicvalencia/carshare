# Phase 8 — Claims and financial resolution

## Configuration

```dotenv
CLAIM_RESPONSE_WINDOW_HOURS=24
SECURITY_DEPOSIT_ENABLED=false
```

The owner claim deadline remains the immutable `claimDeadlineAt` stored during return. The renter
response deadline is stored when the claim is submitted. Deadline processing writes an explicit
`NO_RESPONSE` response and advances the claim to admin review; it never auto-approves a claim.

## Workflows

```text
Owner evidence/measured fact
→ server calculation and earning hold
→ renter acknowledgement or dispute
→ immutable admin adjudication
→ renter-authorized additional payment
→ provider capture and balanced ledger allocation
→ claim resolved
→ booking completed after all blockers clear
→ stored 24-hour earning safety hold
→ earning AVAILABLE
```

Disputes are separate records with `OPEN → EVIDENCE_COLLECTION → UNDER_REVIEW` and terminal
`RESOLVED_FOR_RENTER`, `RESOLVED_FOR_OWNER`, `PARTIALLY_RESOLVED`, or `CLOSED` states. Their source
may be a claim, incident, additional charge, refund, or another post-rental issue.

MVP security-deposit utilization is disabled pending provider selection and certification. The
provider capability model is present, and claims continue through a renter-authorized additional
payment without depending on a deposit.

## API

```text
POST /api/v1/owner/bookings/:reference/claims
GET  /api/v1/owner/claims
GET  /api/v1/owner/claims/:id
POST /api/v1/owner/claims/:id/evidence
POST /api/v1/owner/claims/:id/withdraw

GET  /api/v1/claims
GET  /api/v1/claims/:id
POST /api/v1/claims/:id/respond
POST /api/v1/claims/:id/evidence
GET  /api/v1/additional-charges/:id
POST /api/v1/additional-charges/:id/payment

GET  /api/v1/admin/claims
GET  /api/v1/admin/claims/:id
POST /api/v1/admin/claims/:id/adjudicate
POST /api/v1/admin/disputes/:id/resolve
POST /api/v1/admin/additional-charges/:id/refund
POST /api/v1/admin/earnings/:id/holds
POST /api/v1/admin/earnings/holds/:id/release
```

The admin detail projection includes booking snapshots, inspections, usage, incidents, participant
evidence, response, calculations, adjudications, disputes, payment/refund state, earning holds, and
ledger history. Evidence downloads continue through the private file authorization endpoint.

## Financial rules

- Excess mileage: whole excess kilometres × snapshotted excess-kilometre rate.
- Late return: 30-minute versioned grace; rounded-up billable hours × rounded-up daily/24 rate,
  capped at the daily rate for each 24-hour period.
- Fuel/EV: immutable measured deficiency plus admin platform valuation within the policy cap.
- Cleaning/damage/other: evidence-based admin platform valuation within the policy cap.
- MVP additional-charge allocation: owner 100%, platform 0%, snapshotted per category policy.
- Refunds use the provider first, then append a balanced ledger reversal and owner-earning
  adjustment. Original charges and postings remain unchanged.

## Workers and verification

The rental-operations sweep records response timeouts, completes returned bookings, and releases
eligible earnings. Payment reconciliation handles additional-charge authorization/capture and
reuses the Phase 6 webhook path.

```bash
pnpm db:migrate:deploy
pnpm db:seed
pnpm test:integration
pnpm verify
```

The integration suite exercises real PostgreSQL row locks for claim/completion and earning/hold
races, duplicate adjudication/payment triggers, partial holds, immutable ledger behavior, and the
normal no-claim completion/release path. There is no payout entity or payout action in Phase 8.
