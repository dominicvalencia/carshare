# Provider telemetry privacy boundary

Telemetry defaults off. Disabled mode is a no-op. When Sentry is explicitly enabled, `APP_ENV`, `RELEASE_VERSION`, service, route category, correlation ID, job type and safe internal error code are suitable allowlisted context.

Passwords, OTPs, access/refresh tokens, authorization/cookie headers, message contents, raw KYC evidence, selfies, licence numbers, full private addresses, bank/e-wallet/card data, signed URLs, provider credentials and raw provider payloads are prohibited. The shared scrubber rejects sensitive key names and non-primitive nested values; logger redaction provides a second boundary.

Mobile, API, workers and Admin must initialize Sentry only through their environment-specific entry point. Source-map upload is release-pipeline work and must use the immutable `RELEASE_VERSION`; this phase adds readiness and tests but does not upload maps or create a Sentry project.
