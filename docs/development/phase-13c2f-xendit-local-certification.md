# Phase 13C-2F — Xendit local test-mode certification

Status: **IMPLEMENTED / AUTOMATED VERIFICATION PASS / PHYSICAL XENDIT TEST-MODE PAYMENT CERTIFICATION PASS**

## Scope and API choice

CarShare uses Xendit's current Payment Sessions hosted-checkout API: `POST https://api.xendit.co/sessions`, with `session_type=PAY` and `mode=PAYMENT_LINK`. Payment Requests are the lower-level unified payments API; legacy Invoices are not selected for this new hosted flow. Test/live separation is controlled by the server-side Xendit key. The public key is not required.

Architecture: `certification command → PaymentProvider-compatible Xendit adapter → Xendit Payment Session → hosted test checkout`.

The local command creates one synthetic PHP 100.00 session with reference `carshare-local-xendit-certification`. It does not create or mutate a booking, payment/ledger row, customer, payout, KYC record, webhook state, or production state.

## A. API/session creation

PASS. Exactly one controlled Test Mode Payment Session was created. Xendit returned provider state `ACTIVE` at creation for a `PAY` / `PAYMENT_LINK` session denominated in PHP for PHP 100.00. Basic authentication uses `XENDIT_SECRET_KEY` server-side. A stable idempotency key and an exactly-once local marker protect retries. Safe diagnostics are bounded and redact secrets, email addresses, and card-like values.

## B. Hosted test checkout

PASS. The Xendit hosted Test Mode checkout loaded successfully and displayed CarShare, the description `CarShare Xendit test certification`, and PHP 100.00. Only exact HTTPS test origins are accepted: `https://checkout-staging.xendit.co` and `https://dev.xen.to`. Production, HTTP, credentialed, arbitrary subdomain, lookalike, and suffix-attack URLs are rejected.

## C. Test payment interaction

PASS for the hosted Test Mode interaction only. A Xendit-documented test Mastercard was used, the hosted checkout displayed `Payment successful`, and the success screen showed PHP 100 and Mastercard. No real card, wallet, bank account, or real money was used. Xendit Test Mode uses virtual funds and cannot transact real money.

## D. Return navigation

Payment Session success/cancel return URLs are optional and are omitted for this local certification. Xendit therefore uses its default hosted completion page. A browser return is navigation only and must never mark a booking paid.

The hosted success result is not authoritative CarShare payment confirmation. This isolated helper has no database access and created or modified no booking, persisted CarShare payment, ledger entry, customer, owner payout, KYC record, webhook record, or production state.

## E. Webhook certification — deferred

Authoritative `payment_session.completed` processing requires trusted provider webhook/reconciliation state and public HTTPS. No localhost callback, tunnel, or invented URL is used.

Accordingly, Xendit webhook certification and authoritative CarShare payment and ledger finalization remain deferred.

## F. Production onboarding — deferred

Production credentials, live payment channels, real-money operations, production hosted checkout, capture/refund, and operational acceptance are not started.

## G. Owner payouts — separate milestone

The existing Xendit payout adapter, Money-out permissions, XenPlatform, disbursement, and owner payout flows are explicitly outside this milestone.

## Persisted payment-provider boundary

The Prisma `PaymentProviderCode` enum does not yet include Xendit. The isolated certification helper deliberately persists no business data, so no migration is required for this checkpoint. A reviewed schema migration is required before Xendit can become a normal persisted booking/payment provider.

## Local configuration

Keep these values only in ignored root `.env`:

```dotenv
APP_ENV=local
PAYMENTS_ENABLED=false
PAYOUTS_ENABLED=false
XENDIT_ENVIRONMENT=test
XENDIT_SECRET_KEY=<private test secret key>
XENDIT_CERTIFICATION_ENABLED=false
```

The private test key may remain only in ignored root `.env`. The certification flag and normal payment/payout integrations remain disabled after physical certification.
