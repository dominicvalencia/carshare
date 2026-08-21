# ADR 0012: Provider-independent payments and immutable financial ledger

Status: Accepted — 2026-08-21

## Context

Phase 6 replaces the non-production Phase 5 funding gate. Rental authorization, owner-triggered
capture, authorization cleanup, accounting, and earnings must survive duplicate commands, lost
responses, restarts, delayed webhooks, and provider changes. Maya is the first adapter, but its
merchant capabilities are not universal and its network call cannot join a PostgreSQL transaction.

## Decision

`@carrental/payments` owns provider-neutral inputs, normalized outcomes, capabilities, webhook
events, and adapter contract tests. Maya infrastructure uses hosted Checkout and never accepts or
persists PAN/CVV. Production rejects the fake adapter. Security deposits remain separate and
disabled until provider-specific hold duration, capture, and release behavior is approved.

The external call is made only after a stable `PaymentOperation` and provider request reference are
committed. An authoritative result is then applied atomically: payment transition, booking
transition, immutable commission snapshot, pending earning, balanced ledger postings, history, and
outbox. A timeout is `UNKNOWN`, never a decline. Capture remains `CAPTURE_PENDING`; reconciliation
retrieves the original provider payment and never invents a new idempotency identity.

Maya webhook trust follows its documented model: HTTPS plus the environment-specific Maya source-IP
allowlist. We do not invent a signature header or secret absent from current documentation. The API
hashes the raw body, stores only redacted fields, deduplicates a SHA-256 identity derived from
payment ID, event status, and provider update timestamp, and retrieves provider truth before any
state transition. Redirects are never proof of payment.

Owner rejection, renter cancellation while awaiting owner, and response expiry release inventory
without waiting for a provider call. A durable `VOID` operation remains until confirmed. A
definitive capture failure cancels and schedules cleanup; an unknown capture result remains pending.

## Accounting model

PHP integer minor units use signed entries where positive is debit and negative is credit. Capture
posts two immutable, separately balanced transactions:

1. Debit provider receivable; credit customer funds held.
2. Debit customer funds held; credit owner payable and platform commission revenue.

Commission precedence is owner, vehicle category, then platform default. Rules are versioned and
immutable except for `disabledAt`. Capture snapshots the selected rule and uses the rental subtotal
only. The MVP seed is configurable 1500 basis points. Owner earnings start as `PENDING`; Phase 6 does
not expose withdrawal or payout controls.

Database triggers reject ledger update/delete, unbalanced postings, invalid account currency,
commission snapshot mutation, and concurrent refunds above the captured amount. Corrections require
new reversal/adjustment transactions.

## Maya operational dependency

Authorization/capture and void/refund features must be enabled on the merchant account before
`PAYMENT_PROVIDER=maya` is used. The configured NORMAL authorization hold duration is modeled as six
days based on current Maya guidance, not as a general provider guarantee.

Primary references:

- https://developers.maya.ph/reference/authorize-hold-and-capture-payments-in-maya-checkout
- https://developers.maya.ph/reference/createv1checkout
- https://developers.maya.ph/reference/capturev1payment
- https://developers.maya.ph/reference/getpaymentviapaymentid-1
- https://developers.maya.ph/reference/receive-real-time-payment-information-using-webhooks
- https://developers.maya.ph/reference/managing-voids-and-refunds-in-maya-checkout

## Consequences

- Inventory is not held hostage by a failed void call, while financial cleanup stays explicit.
- Booking and payment states remain independent and customer copy distinguishes authorization from
  capture.
- Provider capture may succeed before local commit; idempotent finalizers and reconciliation close
  that gap without duplicate financial effects.
- Refund and deposit records exist, but arbitrary renter refunds and real deposits remain disabled.
