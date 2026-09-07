# Phase 13C-2C Semaphore local certification

Status: **IMPLEMENTED / AUTOMATED VERIFICATION PASS / PHYSICAL DELIVERY PENDING EXTERNAL SENDER NAME APPROVAL**.

## Real local provider attempt

A single controlled local certification attempt reached Semaphore. Semaphore returned HTTP 500
without a diagnostic message because this account did not yet have an active/default Sender Name.
The request was not accepted, no provider message ID was issued, and no SMS was delivered. This
attempt does not count as successful transport certification.

The `CarShare` Sender Name has been submitted to Semaphore and is pending approval. This external
account/telco approval is the only current blocker to physical delivery certification. No retry
should be made while approval is pending. After Semaphore approves and activates the sender, set
`SEMAPHORE_SENDER_NAME=CarShare` in the ignored root `.env` and run the certification command once.

The failed request left no `.data/provider-certifications/semaphore-local.sent` success marker, so
the exactly-once mechanism remains eligible for that one post-approval retry. The local SMS provider
and certification flags were restored to their safe disabled state after the failed attempt.

The provider boundary is
`certification command → LocalSmsCertificationProvider → SemaphoreSmsProvider`. The explicit
command never runs during API startup. Validated configuration restricts it to `local` or `test`,
requires Semaphore to be explicitly enabled, and sends only to the private
`SEMAPHORE_CERTIFICATION_RECIPIENT` configured in the ignored root `.env`.

The adapter posts `application/x-www-form-urlencoded` data to Semaphore's standard
`https://api.semaphore.co/api/v4/messages` endpoint. The API key remains in the form body required
by Semaphore and is never logged. CarShare canonicalizes supported Philippine mobile formats to
E.164 (`+639XXXXXXXXX`) at its shared boundary, then sends Semaphore the documented `639XXXXXXXXX`
transport representation. The certification body is fixed, contains no OTP or customer data, and
stays within one GSM SMS segment.

Run `pnpm --filter @carrental/api certify:semaphore` only after explicitly enabling the local
certification variables. A local ignored
`.data/provider-certifications/semaphore-local.sent` marker is atomically reserved before the
request and prevents repeated sends. It stores no recipient, API key, or provider message ID.
Automated tests use mocked HTTP responses and consume no credits.

Semaphore requires an active Sender Name. If `SEMAPHORE_SENDER_NAME` is omitted, Semaphore uses the
account's active default Sender Name; if none exists, the provider rejects the request. The branded
`CarShare` Sender Name is pending approval and is not certified by this milestone. Sender Name
registration and approval is a separate account/telco process.

Normal application errors remain provider-neutral. The explicit local certification CLI may report
only HTTP status, a safe provider status/code, a redacted reason, a validated provider message ID,
and normalized delivery status. API keys, complete phone numbers, raw provider responses, and OTPs
are never logged.

OTP business security remains authoritative in CarShare: cryptographic six-digit generation, HMAC
hash persistence, expiry, attempt ceilings, resend cooldown, phone/IP rate limits, one-time
consumption, and invalidation of an older challenge when a replacement is issued. The development
delivery inbox remains restricted to local/test and does not log OTP values. Provider transport
certification uses a fixed non-sensitive message; actual OTP end-to-end handset certification has
not started.

This milestone will certify only:

`CarShare local API → SmsProvider abstraction → Semaphore adapter → Semaphore → controlled Philippine handset`

Public delivery callbacks/webhooks, production SMS enablement, branded `CarShare` Sender Name
approval, and actual OTP end-to-end handset verification remain deferred.
