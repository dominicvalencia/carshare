# Environment variable reference

## Server

- `APP_ENV`: `local`, `test`, `staging`, or `production`.
- `RELEASE_VERSION`: immutable release/commit identifier.
- `DATABASE_ENVIRONMENT`, `REDIS_ENVIRONMENT`: matching fingerprints outside local/test.
- `DATABASE_URL`, `REDIS_URL`: private; non-local Redis uses `rediss://`.
- `API_PUBLIC_URL`, `ADMIN_PUBLIC_URL`: canonical public origins.
- `OBJECT_STORAGE_PROVIDER`: `local` or `s3`; S3 needs matching `OBJECT_STORAGE_ENVIRONMENT`.

Integration flags `PAYMENTS_ENABLED`, `PAYOUTS_ENABLED`, `PUSH_ENABLED`,
`AUTH_DELIVERY_ENABLED`, and `OBSERVABILITY_ENABLED` default false. Email, SMS, and geocoding
default disabled; KYC defaults manual. Credentials are required only for enabled providers.

## Public mobile and Admin values

Mobile may bundle `EXPO_PUBLIC_APP_ENV`, `EXPO_PUBLIC_API_ENV`, `EXPO_PUBLIC_API_URL`,
`EXPO_PUBLIC_RELEASE_VERSION`, `EXPO_PUBLIC_PROJECT_ID`, `EXPO_PUBLIC_SENTRY_DSN`,
`EXPO_PUBLIC_MAPS_TOKEN`, and `EXPO_PUBLIC_PAYMENT_KEY`. Admin may bundle the corresponding
`NEXT_PUBLIC_APP_ENV`, `NEXT_PUBLIC_API_ENV`, `NEXT_PUBLIC_API_URL`, and
`NEXT_PUBLIC_RELEASE_VERSION` values. Never put signing material, provider secrets, DB credentials,
APNs/FCM credentials, or access tokens in public variables.

`.env.example` documents local use. Real staging/production values belong in managed secrets and
protected EAS environments; they are never committed.

Domain-ready deployment manifests may use `PUBLIC_DOMAIN`, `STAGING_API_ORIGIN`,
`STAGING_ADMIN_ORIGIN`, and `STAGING_LINKS_ORIGIN`. They remain unset until a domain is acquired;
no fictitious permanent domain is a runtime default.
