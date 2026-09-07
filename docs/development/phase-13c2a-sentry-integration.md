# Phase 13C-2A Sentry error-monitoring integration

Status: **LOCAL SENTRY CERTIFICATION COMPLETE**. Real, controlled, non-sensitive local events have been received in all four service-specific projects. Public staging and production acceptance remain outside this checkpoint.

## Project and runtime mapping

| Service | Sentry project     | SDK                    | Runtime DSN              |
| ------- | ------------------ | ---------------------- | ------------------------ |
| Mobile  | `carshare-mobile`  | `@sentry/react-native` | `EXPO_PUBLIC_SENTRY_DSN` |
| API     | `carshare-api`     | `@sentry/nestjs`       | `SENTRY_API_DSN`         |
| Workers | `carshare-workers` | `@sentry/node`         | `SENTRY_WORKERS_DSN`     |
| Admin   | `carshare-admin`   | `@sentry/nextjs`       | `NEXT_PUBLIC_SENTRY_DSN` |

## Local certification result

| Service | Real local event |
| ------- | ---------------- |
| Mobile  | PASS             |
| API     | PASS             |
| Workers | PASS             |
| Admin   | PASS             |

Phase 13C-2A local Sentry certification is **COMPLETE**. Public staging Sentry certification, source-map/debug-symbol upload certification, tracing/profiling, and production Sentry acceptance remain deferred or not started. All local certification switches were restored to false after testing.

`SENTRY_ENABLED=true` activates API, workers, and Expo-configured mobile telemetry; Admin uses `NEXT_PUBLIC_SENTRY_ENABLED=true` because browser initialization must be statically available. Enabled services fail configuration when their DSN is missing. Disabled services are valid no-ops. Client DSNs are public identifiers, but remain environment-configured. Server DSNs never cross into public variables.

Every runtime reports `environment`, `release`, and `service`. Mobile also supplies app version/build where available. Tracing and profiling are explicitly zero; replay, SDK logs, default PII, screenshots and broad request payload capture are disabled.

## Privacy boundary

The shared `beforeSend` scrubber removes users, request bodies, headers, cookies, query strings, breadcrumb data, nested payloads and sensitive-key context. Only operational fields such as correlation ID, route category, safe internal error code, queue/job identifiers, version/build, environment, release, and service are allowlisted. Password/passcode/OTP, tokens/JWTs, government or driver-license identifiers, addresses, email/phone, messages, payment/bank/e-wallet/card fields, KYC/selfie/document evidence, signed URLs, storage grants, webhook signatures and provider credentials are prohibited.

## One-event local certification

Put real DSNs only in the ignored repository `.env`, keep `APP_ENV=local`, and use `RELEASE_VERSION=local-sentry-certification`. Enable only the service being checked where practical.

- Mobile: set `SENTRY_ENABLED=true`, `EXPO_PUBLIC_SENTRY_DSN=<carshare-mobile DSN>`, and `EXPO_PUBLIC_SENTRY_TEST_EVENT_ENABLED=true`; rebuild the native development client, start Metro, and launch once. Set the test switch back to false immediately.
- API: set `SENTRY_ENABLED=true`, `SENTRY_API_DSN=<carshare-api DSN>`, and `SENTRY_TEST_EVENT_ENABLED=true`; run `pnpm --filter @carrental/api dev`, wait for the one startup event, stop, and reset the test switch.
- Workers: set `SENTRY_ENABLED=true`, `SENTRY_WORKERS_DSN=<carshare-workers DSN>`, and `SENTRY_TEST_EVENT_ENABLED=true`; run `pnpm --filter @carrental/workers dev`, wait for the one startup event, stop, and reset the switch.
- Admin: the repository-root ignored `.env` is authoritative because `apps/admin-web/next.config.ts` loads it before Next compiles the browser bundle. Set `NEXT_PUBLIC_APP_ENV=local`, `NEXT_PUBLIC_RELEASE_VERSION=local-sentry-certification`, `NEXT_PUBLIC_SENTRY_ENABLED=true`, `NEXT_PUBLIC_SENTRY_DSN=<carshare-admin DSN>`, and `NEXT_PUBLIC_SENTRY_TEST_EVENT_ENABLED=true`; fully restart `pnpm --filter @carrental/admin-web dev`, then open `http://localhost:3001/` once. Browser initialization emits at most one event per browser session without login and prints only boolean/non-sensitive diagnostics. Stop and reset the test switch immediately. `apps/admin-web/.env.local` is ignored and supported by Next, but is not required and should not duplicate the root configuration.

For each project, confirm exactly the corresponding non-sensitive `CarShare … local Sentry certification` event, environment `local`, release `local-sentry-certification`, and the correct `service` tag. Do not leave certification switches enabled.

## Native and source-map boundary

React Native adds a native SDK and Expo config plugin, so a new iOS and Android development build is required; Metro reload alone is insufficient. The plugin disables automatic upload for now. Next/Node runtime reporting also works without source-map upload. Future symbol/source-map upload requires managed build-time auth, explicit organization/project mapping, and the same immutable release identifier. It is deferred until the controlled staging/EAS release workflow.

No Sentry auth token, DSN, DigitalOcean resource, public staging environment, or other provider integration is created by this work.
