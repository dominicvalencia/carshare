# Phase 13C-2 local provider integration foundation

Status: implemented and checkpointed. Sentry real-SDK integration is tracked separately in Phase 13C-2A and remains pending manual event certification.

Phase 13C-1 environment separation remains complete. Phase 13C-2 deliberately implements provider boundaries before any DigitalOcean or public staging work. Local/test stays deterministic and paid providers are opt-in.

## Provider matrix

| Capability | Local/test default  | Prepared external adapter                             | Authority and safety boundary                                                      |
| ---------- | ------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Telemetry  | no-op               | Sentry configuration boundary                         | allowlisted context; sensitive keys scrubbed                                       |
| Email      | development inbox   | Postmark template API                                 | no real customer mail in tests                                                     |
| SMS OTP    | development inbox   | Semaphore API                                         | hashed DB challenge, expiry, attempts, resend and rate limits remain authoritative |
| Push       | fake/in-app         | Expo with Firebase/FCM project boundary               | tokens scoped by environment and app identity                                      |
| Payments   | fake                | Maya sandbox                                          | payment operations, webhook events, ledger and reconciliation stay authoritative   |
| Payouts    | fake                | Xendit test mode                                      | payout operations, webhook events, ledger and reconciliation stay authoritative    |
| KYC        | manual Admin review | fake provider-neutral signals; Sumsub config boundary | automation always requires manual review                                           |

Provider SDK details do not enter domain services. Services call interfaces; adapters map requests, responses and provider errors into internal outcomes. Network adapters use finite timeouts and idempotency keys. Retryable, non-retryable and ambiguous/reconcile outcomes are distinct.

## Local QA matrix

- Auth: verification email and SMS OTP through development inbox; expiry, attempt maximum, resend cooldown, phone/IP limits and provider-disabled behavior.
- Booking: fake authorization, authentication-required, accepted/declined/unknown, capture, void, refund and reconciliation; Maya fixtures cover mapping without real money.
- Payout: eligible earnings, admin-controlled initiation, submitted/processing/succeeded/failed and reconciliation; Xendit fixtures remain test-mode only.
- KYC: manual-only decision, simulated document/authenticity/liveness/face-match signals, unavailable provider and manual escalation. Provider signals cannot approve or reject.
- Push: environment/app-scoped registration, replacement, revoked-session exclusion, fake delivery, invalid-token disabling, audience-aware content and strict deep-link target allowlist.
- Email/SMS: accepted, delayed, retryable outage, bounce/complaint/suppression or failed callback normalization. No test sends a real customer message.

Local webhook tests invoke verifiers with deterministic raw-body fixtures for valid/missing/invalid signatures, stale timestamps, replay, content type, body size and unknown status. Existing financial webhook tables enforce durable replay/idempotency. Public HTTPS delivery remains unverified.

## Account sequence

Optional now: Sentry project/DSN for opt-in local event inspection; Firebase project/Android app for preparation; a KYC sandbox for vendor evaluation.

Required for real sandbox testing: a Postmark server token and verified sender; Semaphore API key (and an approved Sender ID before branded pilot messages); Maya sandbox merchant with authorization/capture capability and keys; Xendit test account with Money-out capability, API key and callback token; chosen KYC vendor sandbox credentials.

Required only once public staging exists: reachable HTTPS webhook URLs, provider callback registration and delivery certification; Postmark domain authentication for production-quality sending; production push credentials and native builds. Environment variables alone never certify a provider.

## Deferred boundary

No DigitalOcean resources, public staging, DNS, public webhook, production credentials, production delivery, real payment/payout, automatic KYC decision, or Phase 13C-3 work is included.
