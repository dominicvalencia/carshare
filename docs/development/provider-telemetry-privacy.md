# Provider telemetry privacy boundary

Telemetry defaults off. Disabled mode is a no-op. When Sentry is explicitly enabled, `APP_ENV`, `RELEASE_VERSION`, service, route category, correlation ID, job type and safe internal error code are suitable allowlisted context.

Passwords, OTPs, access/refresh tokens, authorization/cookie headers, message contents, raw KYC evidence, selfies, licence numbers, full private addresses, bank/e-wallet/card data, signed URLs, provider credentials and raw provider payloads are prohibited. The shared scrubber rejects sensitive key names and non-primitive nested values; logger redaction provides a second boundary.

Mobile, API, workers and Admin initialize Sentry only through their environment-specific entry point. Before-send processing removes user identity, request bodies, headers, cookies, query strings, breadcrumb data and non-allowlisted context. Error text is scrubbed for bearer credentials, JWTs, email addresses and signed-query values. Default PII, logs, screenshots, view hierarchy, request-failure payload capture and replay are disabled.

Source-map/debug-symbol upload is release-pipeline work and must use the immutable `RELEASE_VERSION`. Runtime error reporting does not need a Sentry auth token. Build upload later requires a managed `SENTRY_AUTH_TOKEN`, organization/project mapping, and identical release name; no token is accepted in public variables or source control.
