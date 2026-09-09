# ADR 0029: Owner revenue and earnings contract

Status: Accepted for Phase 13C-2H-C1

Definition version: `owner-revenue-v1`

## Decision

`GET /api/v1/admin/owner/revenue` is the authoritative aggregate Revenue & Earnings API. It reuses the `owner-analytics-v1` Manila period resolver and is available only to the authenticated administrative `OWNER`; `SUPER_ADMIN`, `STAFF`, and unauthenticated callers are denied.

Money remains integer minor units internally, is returned as decimal strings, and is grouped by ISO currency without implicit foreign exchange.

## Period activity

- Rental collections are reconciled captured `Payment.capturedAmountMinor` values. Authorizations, voids, failures, and reconciliation-required records are excluded.
- Rental GBV is the immutable `BookingPricingSnapshot.totalMinor`; it is distinct from actual collections.
- Recognized CarShare commission is the negative posted movement on `PLATFORM_COMMISSION_REVENUE`, attributed by ledger posting time.
- Owner earnings use `OwnerEarning`, preserve every status, and equal net rental earning plus additional compensation plus adjustments.
- Completed refunds use `Refund.amountMinor` at `completedAt` and remain separate from GBV, collections, and earnings.
- Additional-charge and payout lifecycle activity remains separately classified and uses its authoritative lifecycle timestamps.

## Point-in-time balances

- Owner Payable Liability is the negative posted `OWNER_PAYABLE` ledger balance at generation time. It is a liability, not revenue, cash, selected-period earnings, or immediately withdrawable money.
- Available for Payout is the narrower set of `AVAILABLE` earnings that passes the shared payout eligibility rules, including owner readiness, holds, allocations, claims, disputes, incidents, and payment reconciliation.
- Earning status balances, active payout allocations, and processing payouts are explicit operational balances. They have no selected-period comparison semantics.

## Boundaries

GBV is not collections or CarShare revenue. Owner earnings are not payouts. Owner payable liability is not available for payout. Authorization is not collection. Security-deposit authorization/release is neither revenue nor refund; C1 reports no captured-deposit total because no independently proven capture-ledger baseline exists.

True net platform revenue, profit, payment-provider fees, taxes, withholding, cancellation revenue, chargebacks, FX-converted totals, settlement-bank reconciliation, and owner tax reporting are unavailable.

Financial reconciliation fails closed. The response exposes only safe aggregate warning counts and never customer identity, payment instruments, payout destinations, provider references, ledger rows, webhook bodies, credentials, or raw audit payloads.
