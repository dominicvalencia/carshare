# Phase 13C-2E — Maya Checkout local sandbox certification

## Status

**COMPLETE / PASS.** Implementation, automated verification, controlled Checkout creation, hosted
sandbox page loading, and sandbox payment interaction are accepted for the local Maya Checkout
sandbox path. This is not production readiness and does not certify authoritative payment
finalization.

The first real Maya sandbox request reached the provider but did not produce an accepted hosted
Checkout URL. The original implementation discarded the safe shape of an incomplete HTTP-success
response, so its exact HTTP status and Maya error details could not be recovered retroactively. No
success marker was written for that attempt.

The diagnostic repair preserves HTTP status plus allowlisted Maya error code/message fields for an
incomplete response and adds the fixed synthetic request reference. Values are bounded and scrubbed
for API-key patterns, email addresses, and card-like numbers. Normal application-facing handling
remains provider-neutral.

The second controlled request returned a Checkout identifier and a hosted URL under
`https://payments-web-sandbox.maya.ph`. CarShare rejected the response locally because its exact
origin allowlist contained only Maya's legacy documented
`https://payments-web-sandbox.paymaya.com` hostname. No success marker was written and physical
Checkout certification remains pending. The current `maya.ph` host was independently verified over
valid HTTPS with Maya Checkout service headers. Both exact sandbox origins are now accepted; the
legacy origin remains because Maya's current published environment table still lists it. HTTP,
production origins, arbitrary subdomains, lookalikes, suffix attacks, and credentialed URLs remain
rejected. The final controlled request returned `CHECKOUT_CREATED` under the current official
observed sandbox origin. The hosted Maya page opened, displayed PHP 100.00, and completed a payment
interaction using a Maya-documented sandbox instrument. No real money, customer, booking, KYC,
cardholder, or private data was used.

### A. Maya Checkout sandbox API certification

**PASS.** CarShare uses the existing boundary:

`booking/domain service → PaymentProvider → MayaPaymentProvider → Maya hosted Checkout`

The explicit `pnpm --filter @carrental/api certify:maya` command creates one synthetic PHP 100.00
ordinary Checkout. It does not create or mutate a booking, payment ledger entry, customer record, or
provider webhook record. A filesystem marker prevents a second accepted checkout from the same
local workspace. A failed attempt removes the marker so a diagnosed failure can be retried.

Maya's official documentation permits its published shared sandbox Checkout credentials when a
merchant does not have Maya Business Manager access. They are shared exploration credentials, not
private merchant certification or production credentials. A Business Manager application is not
required for this limited Checkout-creation exercise. Private credentials, when available, belong
only in the ignored root `.env` and must never use an `EXPO_PUBLIC_*` name.

Current contract:

- Sandbox API host: `https://pg-sandbox.paymaya.com`
- Create Checkout: `POST /checkout/v1/checkouts`
- Authentication: HTTP Basic with the public API key as the username and an empty password
- Fixed amount/currency: PHP 100.00 (`10000` minor units in CarShare)
- Fixed reference: `carshare-local-maya-certification`
- Hosted checkout origins: `https://payments-web-sandbox.maya.ph` and the currently documented
  legacy `https://payments-web-sandbox.paymaya.com`
- Checkout lifetime: one hour
- Secret key: server-side retrieval, capture, void, refund, cancellation, and webhook-management
  operations; it is not placed in a mobile or browser bundle

### B. Hosted checkout physical/browser certification

**PASS.** The controlled Checkout returned `CHECKOUT_CREATED`, the hosted sandbox page opened under
`https://payments-web-sandbox.maya.ph`, PHP 100.00 was displayed, and a Maya-documented sandbox
payment interaction completed. No real card, wallet, charge, or customer data was involved.

### C. Return/deep-link certification

**NAVIGATION ONLY / NOT PAYMENT PROOF.** The repository currently has no dedicated mobile routes for Maya payment
success, failure, or cancellation. The existing local values are fixed localhost response-page
placeholders:

- `http://localhost:8081/payment/success`
- `http://localhost:8081/payment/failure`
- `http://localhost:8081/payment/cancel`

The local certification command accepts only those exact three values and rejects arbitrary return
URLs. A browser redirect is navigation only and is never authoritative evidence that payment
succeeded. Dedicated allowlisted CarShare app-return routes can be designed separately, without
changing the trusted payment-state rules.

### D. Maya webhook certification

**DEFERRED — REQUIRES PUBLIC HTTPS STAGING.** No fake URL, localhost callback, or temporary tunnel
is used. Maya's documented final-state mechanism is a verified webhook, with provider retrieval as a
fallback. Until a public HTTPS endpoint exists, no sandbox webhook receipt, source verification, or
booking/ledger finalization is certified. Browser return state must never mark a booking paid.

### E. Production Maya merchant onboarding

**DEFERRED / NOT STARTED.** Production keys, endpoints, merchant activation, live payment
instruments, real charges, and production operations are outside Phase 13C-2E local certification.

## Local configuration

The ignored repository-root `.env` is restored to the safe post-certification state:

```dotenv
PAYMENTS_ENABLED=false
PAYMENT_PROVIDER=fake
MAYA_AUTH_CAPTURE_ENABLED=false
MAYA_VOID_REFUND_ENABLED=false
MAYA_CERTIFICATION_ENABLED=false
```

For the now-completed controlled certification, the existing variables were temporarily configured
as follows:

```dotenv
APP_ENV=local
PAYMENTS_ENABLED=false
PAYMENT_PROVIDER=maya
MAYA_ENVIRONMENT=sandbox
MAYA_PUBLIC_KEY=<Maya sandbox public key>
MAYA_SECRET_KEY=<Maya sandbox secret key, if later retrieval is exercised>
MAYA_AUTH_CAPTURE_ENABLED=false
MAYA_VOID_REFUND_ENABLED=false
MAYA_SUCCESS_URL=http://localhost:8081/payment/success
MAYA_FAILURE_URL=http://localhost:8081/payment/failure
MAYA_CANCEL_URL=http://localhost:8081/payment/cancel
MAYA_CERTIFICATION_ENABLED=true
```

`PAYMENTS_ENABLED=false` deliberately keeps the application payment flow disabled during this
isolated synthetic Checkout exercise. The explicit certification switch is false by default.

## Safety and state model audit

The existing database models already store provider payment identifiers, attempts, idempotency
keys, financial webhook identities, ledger postings, and reconciliation state. Booking authorization,
owner acceptance capture, void/cancellation, refund, unknown-state reconciliation, and ledger
finalization remain in `PaymentsService` behind `PaymentProvider`. The fake provider remains the
local default. No database migration is required for this certification helper.

Automated tests mock transport and make zero requests to Maya. They cover ordinary Checkout shape,
PHP amount validation, wrong currency, authentication failures, malformed responses, timeouts,
rate limiting, provider 5xx responses, fixed return URL allowlisting, production hosted-URL
rejection, idempotency, duplicate prevention, retry after a rejected attempt, and secret-neutral
errors/markers.

## Official references

- [Maya sandbox credentials and cards](https://developers.maya.ph/reference/sandbox-credentials-and-cards)
- [Accept a one-time payment using Maya Checkout](https://developers.maya.ph/reference/accept-one-time-payment-using-maya-checkout)
- [Testing and validating Maya Checkout](https://developers.maya.ph/reference/testing-and-validating-your-maya-checkout-integration)
- [Configuring Maya Checkout webhooks](https://developers.maya.ph/reference/configuring-your-webhook-for-maya-checkout)
