# Environment variable reference

## Server

- `APP_ENV`: `local`, `test`, `staging`, or `production`.
- `RELEASE_VERSION`: immutable release/commit identifier.
- `DATABASE_ENVIRONMENT`, `REDIS_ENVIRONMENT`: matching fingerprints outside local/test.
- `DATABASE_URL`, `REDIS_URL`: private; non-local Redis uses `rediss://`.
- `API_PUBLIC_URL`, `ADMIN_PUBLIC_URL`: canonical public origins.
- `OBJECT_STORAGE_PROVIDER`: `local` or `s3`; S3 needs matching `OBJECT_STORAGE_ENVIRONMENT`.

Integration flags `PAYMENTS_ENABLED`, `PAYOUTS_ENABLED`, `PUSH_ENABLED`,
`AUTH_DELIVERY_ENABLED`, `EMAIL_ENABLED`, `SMS_OTP_ENABLED`, `AUTOMATED_KYC_ENABLED`,
`OBSERVABILITY_ENABLED`, and `SENTRY_ENABLED` default false. Email and SMS default disabled; KYC
defaults manual. Enabled Postmark requires `POSTMARK_SERVER_TOKEN` and `POSTMARK_FROM_EMAIL`;
the explicit local/test certification additionally requires `POSTMARK_CERTIFICATION_ENABLED=true`
and `POSTMARK_CERTIFICATION_RECIPIENT`. Enabled Semaphore requires `SEMAPHORE_API_KEY`; enabled Sumsub requires `SUMSUB_APP_TOKEN` and
`SUMSUB_SECRET_KEY`; enabled API Sentry requires `SENTRY_API_DSN`, while enabled workers require
`SENTRY_WORKERS_DSN`. Optional Firebase preparation uses
`FIREBASE_PROJECT_ID`, `FIREBASE_ANDROID_APP_ID`, and a managed `FCM_CREDENTIALS_BASE64` secret.
Credentials are required only for the enabled concrete provider.

The explicit local/test Android push certification additionally requires `PUSH_ENABLED=true`,
`PUSH_PROVIDER=expo`, `PUSH_CERTIFICATION_ENABLED=true`, and
`PUSH_CERTIFICATION_EXPO_TOKEN`. Mobile native configuration uses the non-public build-time values
`EXPO_ANDROID_GOOGLE_SERVICES_FILE` and `EXPO_ANDROID_FIREBASE_ENV`; the latter must match
`EXPO_PUBLIC_APP_ENV`. Keep the Firebase client JSON under ignored `.data/`. The Expo project UUID
remains environment-provided through `EXPO_PUBLIC_PROJECT_ID` and is exposed to EAS as
`extra.eas.projectId`. Non-local profiles must explicitly bind it with `EXPO_PUBLIC_PROJECT_ENV`
matching `EXPO_PUBLIC_APP_ENV`; no Firebase server credential belongs in an `EXPO_PUBLIC_*` value.

The B3 Google location picker uses separate environment-bound credentials:
`EXPO_ANDROID_GOOGLE_MAPS_KEY`, `EXPO_IOS_GOOGLE_MAPS_KEY`, and
`EXPO_GOOGLE_MAPS_ENV=local` configure the native Google map renderers. The separate server-only
`GOOGLE_MAPS_SERVER_KEY` is required only when `GEOCODING_PROVIDER=google` and is restricted to
Places API (New) and Geocoding API. Keep every value in the ignored root `.env`; never expose the
server key through an `EXPO_PUBLIC_*` variable.

The explicit local/test Semaphore transport certification additionally requires
`SMS_OTP_ENABLED=true`, `SMS_PROVIDER=semaphore`, `SEMAPHORE_CERTIFICATION_ENABLED=true`, and
`SEMAPHORE_CERTIFICATION_RECIPIENT`. `SEMAPHORE_SENDER_NAME` is optional only when the Semaphore
account already has an active default Sender Name. Certification variables and provider enablement
must normally remain disabled.

## Public mobile and Admin values

Mobile may bundle `EXPO_PUBLIC_APP_ENV`, `EXPO_PUBLIC_API_ENV`, `EXPO_PUBLIC_API_URL`,
`EXPO_PUBLIC_RELEASE_VERSION`, `EXPO_PUBLIC_PROJECT_ID`, `EXPO_PUBLIC_SENTRY_DSN`,
`EXPO_PUBLIC_MAPS_TOKEN`, and `EXPO_PUBLIC_PAYMENT_KEY`. Admin may bundle the corresponding
`NEXT_PUBLIC_APP_ENV`, `NEXT_PUBLIC_API_ENV`, `NEXT_PUBLIC_API_URL`,
`NEXT_PUBLIC_RELEASE_VERSION`, `NEXT_PUBLIC_SENTRY_ENABLED`, and `NEXT_PUBLIC_SENTRY_DSN` values.
Mobile enablement is resolved from `SENTRY_ENABLED` at Expo config time. Never put signing material, provider secrets, DB credentials,
APNs/FCM credentials, or access tokens in public variables.

`.env.example` documents local use. Real staging/production values belong in managed secrets and
protected EAS environments; they are never committed.

Domain-ready deployment manifests may use `PUBLIC_DOMAIN`, `STAGING_API_ORIGIN`,
`STAGING_ADMIN_ORIGIN`, and `STAGING_LINKS_ORIGIN`. They remain unset until a domain is acquired;
no fictitious permanent domain is a runtime default.
