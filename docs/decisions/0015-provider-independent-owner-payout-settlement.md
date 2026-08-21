# ADR-0015: Provider-independent owner payout settlement

- Status: Accepted
- Date: 2026-08-21

## Context

Phase 8 makes an owner's earning `AVAILABLE` only after the claim window, safety hold, and any blocking claim or dispute have cleared. Phase 9 must transfer those liabilities to Philippine bank accounts and e-wallets without turning the earning table into an editable wallet, coupling the domain to one provider, or risking duplicate transfers.

## Decision

Payouts are an explicit, admin-controlled settlement workflow. The domain depends on the `PayoutProvider` contract in `@carrental/payouts`; Xendit and the deterministic fake are infrastructure adapters. Production configuration rejects the fake adapter.

An owner payout requires a verified `OwnerProfile`, a separately `ELIGIBLE` `PayoutEligibility`, an `ACTIVE` destination, and one or more unallocated `AVAILABLE` earnings. The centralized eligibility service rechecks active holds, claims, disputes, critical incidents, payment reconciliation, owner suspension, destination readiness, currency, and allocation state.

Payout destinations use AES-256-GCM field encryption. An HMAC fingerprint supports equality checks, and only a masked identifier is returned, audited, logged, copied into a payout snapshot, or included in an event. Encryption and fingerprint secrets are separate.

Each payout has immutable items and operation history. A partial PostgreSQL unique index permits only one active allocation for an earning. Selection is oldest-first under row locks with `SKIP LOCKED`. Each payout contains whole earnings for exactly one owner. A batch is an operational grouping; each member payout remains independently authoritative.

The state machine is:

```text
DRAFT → PENDING_APPROVAL → APPROVED → SUBMITTING → PROCESSING → PAID
                             │              │             ├→ FAILED
                             └→ CANCELLED   └→ FAILED     └→ REVERSED
```

Only explicit commands may transition state. A database trigger rejects invalid transitions. Four-eyes approval can be enabled later and defaults off. Automatic creation and automatic submission default off.

Provider submission uses the stable key `payout:{payoutId}:submit:v1`. The database transaction claims the command before the network call, but no database transaction remains open during provider I/O. A missing HTTP response leaves the original transfer reconcilable; retries never choose a new key.

Authenticated webhook payloads are normalized by the adapter, stored in redacted form, deduplicated, and confirmed using provider retrieval. Reconciliation handles stale submissions, processing payouts, ambiguous results, webhook backlog, and provider/internal differences. State application uses a payout row lock so webhook/retrieve races settle once.

## Accounting

The immutable, balanced postings are:

```text
Submission:         debit OWNER_PAYABLE, credit PAYOUT_PROVIDER_CLEARING
Provider success:   debit PAYOUT_PROVIDER_CLEARING, credit PAYOUT_CASH
Submission failure: debit PAYOUT_PROVIDER_CLEARING, credit OWNER_PAYABLE
Provider reversal:  debit PAYOUT_CASH, credit OWNER_PAYABLE
```

Provider fees are platform-funded in MVP and use a separate fee-expense hook when authoritative fee data is available. Withholding fields exist as zero-valued snapshots, but withholding calculation and remittance are disabled pending professional review.

## Consequences

- Provider types cannot leak into earnings, ledger, API, mobile, or admin contracts.
- A destination change cannot reroute a created payout because its safe destination snapshot is immutable.
- Failed payout history and items remain; the active allocation is released only after reversal accounting is safe.
- `PAID` is possible only after authoritative provider success and exactly one settlement posting.
- Xendit requires channel certification and real test credentials before live certification can be claimed.
