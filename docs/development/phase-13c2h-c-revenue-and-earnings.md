# Phase 13C-2H-C: Revenue & Earnings

## C1 — authoritative contract and API core

Phase 13C-2H-C1 introduces the server-owned `owner-revenue-v1` definition and `GET /api/v1/admin/owner/revenue`. The endpoint is aggregate-only, OWNER-only, environment-labelled, currency-separated, and uses the shared `Asia/Manila` reporting period resolver for `TODAY`, `THIS_WEEK`, `THIS_MONTH`, and bounded `CUSTOM` periods.

Final status: **IMPLEMENTED / AUTOMATED VERIFICATION PASS / ACCOUNTING RECONCILIATION PASS**. This is an API-only slice and does not require separate physical UI acceptance.

The response separates selected-period activity from balances evaluated at `generatedAt`. Important zero-value categories remain contractual even when no local activity exists. Reconciliation-required captures are excluded and surfaced through a safe aggregate integrity warning.

No Revenue & Earnings UI, transaction table, trend chart, provider request, schema change, or migration belongs to C1. Authoritative trends are deferred to C3. Phase 13C-3 public staging remains paused.

## Accepted local reconciliation

The accepted local authoritative period reconciled to:

- rental collections: PHP 13,400.00;
- rental GBV: PHP 13,400.00;
- recognized CarShare commission: PHP 2,010.00; and
- period owner earnings: PHP 11,390.00.

The point-in-time Owner Payable Liability was PHP 13,175.00. Available for Payout was empty because the existing payout-readiness controls were not all satisfied. No data was altered to force these values.

The representative local query plans completed in approximately 0.185 ms for captured collections, 1.215 ms for recognized commission, and 0.176 ms for Owner Payable Liability. No speculative index, Redis cache, materialized view, projection, or background reporting process was introduced.

The migration count remains 39. Both local `carrental` and disposable integration `carrental_test` were up to date at acceptance; no schema or historical migration changed.

See [ADR 0029](../decisions/0029-owner-revenue-and-earnings-contract.md) for terminology and accounting boundaries.
