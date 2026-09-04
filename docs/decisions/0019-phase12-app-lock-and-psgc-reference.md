# ADR-0019: Local app lock and platform-owned PSGC reference

## Status

Accepted for Phase 12 pilot stabilization.

The custom PIN/PBKDF2 app-lock portion is superseded by
[ADR-0025](0025-biometric-only-local-app-lock.md). The platform-owned PSGC decision below remains
accepted. The historical PIN text is retained to record the original decision and benchmark that led
to its replacement.

## Context

Authenticated renters need an optional local privacy barrier that does not shorten or replace the API
session. Philippine KYC address entry also needs authoritative, searchable geographic relationships
without making the mobile client depend on PSA uptime.

## Decision

The single Expo mobile application supports an account-scoped six-digit app PIN and optional
operating-system biometrics. A configured lock is restored locked on cold start and activates after
five minutes in the background. The PIN never leaves the device: SecureStore contains a random salt
and PBKDF2-SHA-256 verifier (120,000 iterations), scoped by user ID. Face ID, Touch ID, and Android
biometric matching are delegated to the operating system through Expo Local Authentication. Forgot-PIN
recovery clears only that account's local lock and performs the normal authenticated logout; the user
must sign in or use the existing account-recovery path.

The lock screen automatically makes one operating-system biometric attempt when biometrics are
enabled and enrolled. Cancellation or failure leaves the app locked with PIN fallback and an explicit
retry; it never loops prompts. PIN creation, confirmation, change, and unlock use one obscured six-dot
numeric control with a Done return key. Unlock submits at digit six.

PBKDF2 remains at 120,000 iterations. The mobile implementation uses the asynchronous yielding API so
React Native can paint the progress state between derivation slices. Development-only profiling
separates derivation, SecureStore read/write, comparison, and total time without recording PINs, salts,
or verifiers. A successful unlock performs one SecureStore read and no write; inactivity is persisted
when the app leaves the foreground instead of redundantly rewriting SecureStore after every unlock.

The Phase 12 Expo Go simulator benchmark identified PBKDF2 execution in Hermes, rather than rendering,
comparison, or SecureStore, as the remaining bottleneck. On an iPhone 17 Pro/iOS 26.5 simulator a
successful verification measured 20,795 ms, of which 20,795 ms was derivation and less than 1 ms was
SecureStore read plus comparison. On an iPhone SE (3rd generation)/iOS 18.5 simulator it measured
20,876 ms, of which 20,876 ms was derivation. Removing the prior post-unlock SecureStore update saves
approximately 6.7 ms and 6.2 ms respectively, but cannot make pure-JavaScript PBKDF2 prompt at the
approved work factor. These are development simulator component measurements, not physical-device
performance claims. The production mobile build therefore needs a supported native PBKDF2/WebCrypto
implementation and physical-device benchmark before pilot release; reducing the work factor is not the
accepted remedy. Expo Go does not provide that native PBKDF2 path.

The platform imports a versioned derivative of the official PSA PSGC workbook into PostgreSQL. Mobile
requests platform geography endpoints; no interactive KYC request calls PSA. Stored profiles retain
both normalized official names and ten-digit PSGC identifiers. Region, province/geographic scope,
city/municipality, and barangay relationships are validated server-side. Independent cities,
province-less areas, the BARMM Special Geographic Area, and submunicipality barangay groupings are
modeled explicitly rather than forced into a simple province hierarchy.

The imported baseline is **PSGC 2Q 2026**, current as of **30 June 2026**. The normalized artifact
records the official source URL and SHA-256 digest. Synchronization is transactional and upserts by PSGC
code, so repeated imports do not create duplicates; rows absent from the selected dataset version are
made inactive.

## Consequences

- Local lock expiration does not revoke a server session.
- Logging out, secure recovery, and account switching cannot inherit another account's app lock.
- Enabling biometrics when a PIN exists uses OS authentication and does not request the PIN again;
  disabling biometrics also requires OS authentication.
- Simulator timing is a release gate, not evidence that the native production path is slow; the native
  implementation must retain the stored record format and 120,000-iteration policy so existing local
  locks remain compatible.
- Mobile forms work while PSA is unavailable as long as the platform API and imported reference are
  available.
- Updating the PSGC dataset is a controlled operator action: obtain the official workbook, normalize,
  review metadata/counts, migrate, and run the idempotent sync.
- This decision adds no custom face recognition, liveness claim, OCR, or production KYC provider.
