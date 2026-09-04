# Native development-build acceptance plan

## Status and boundary

Phase 13B preparation began September 4, 2026 after Phase 12 acceptance. The repository configuration
is ready to produce native development clients, but no signed physical-device build or checklist item
below is accepted merely because the setup exists. See
[`phase-13b-native-development-build-setup.md`](phase-13b-native-development-build-setup.md) for build,
environment, signing, device, and user-owned prerequisite instructions. Phase 13C and later remain
deferred.

Legend:

- **P12 accepted:** behavior is accepted at the current functional/API/export boundary.
- **Native validation:** repeat on signed physical-device development builds.
- **Provider validation:** requires configured production-like or certified external infrastructure.

## Auth, session, and secure storage

- [ ] Native validation — login, logout, refresh rotation, concurrent refresh, and invalid-session exit.
- [ ] Native validation — session restoration after cold restart and background termination.
- [ ] Native validation — renter/owner account and mode switching without query/cache leakage.
- [ ] Native validation — SecureStore persistence, logout cleanup, account isolation, and reinstall
      behavior appropriate to iOS Keychain and Android storage semantics.
- P12 accepted — server reloads current session/account/roles; mobile refresh tokens use SecureStore.

## Biometrics and app lifecycle lock

- [ ] Native validation — Face ID, Touch ID where available, and representative Android biometrics.
- [ ] Native validation — cancelled/failed prompt remains locked; explicit retry succeeds.
- [ ] Native validation — logout/account switching cannot inherit another account's lock.
- [ ] Native validation — five-minute background inactivity locks and foreground unlocks correctly.
- P12 accepted — biometric matching belongs to the OS; there is no custom PIN fallback or biometric
  template stored by the app.

## Camera and evidence

- [ ] Native validation — renter front-camera selfie and rear-camera KYC documents.
- [ ] Native validation — vehicle photos/documents and pickup/return inspection perspectives.
- [ ] Native validation — first-run denial, later Settings grant, permanent denial, interruption,
      retake, Use Photo, persisted preview, upload retry, and low-network behavior.
- P12 accepted — renter KYC is camera-only and evidence remains object-authorized/immutable.
- Provider validation — malware scanning, durable object storage, retention/deletion, backups, and
  production media variants.

## Push, badges, and notification navigation

- [ ] Native validation — permission request and denied-permission in-app behavior.
- [ ] Native validation — foreground, background, and terminated-app delivery.
- [ ] Native validation — booking, lifecycle, message, claim, and review notifications.
- [ ] Native validation — badge synchronization/read state and notification cold-start navigation.
- [ ] Native validation — renter/owner mode is preserved or deliberately changed by an allowed route.
- P12 accepted — in-app rows/outbox idempotency and role-aware internal routing.
- Provider validation — Expo/APNs/FCM credentials, token lifecycle, receipts, retry classification, and
  production delivery monitoring.

## Deep links

- [ ] Native validation — email verification links from installed mail clients.
- [ ] Native validation — booking, pickup/return, claim, Host Profile, and public review destinations.
- [ ] Native validation — authenticated, signed-out, stale-target, and cold-start behavior.
- Provider validation — production universal/app-link domains, association files, and delivery URLs.

## Resilience and lifecycle matrix

- [ ] Native validation — foreground/background/termination/restart across critical forms.
- [ ] Native validation — network loss and recovery during login, KYC upload, quote, booking, pickup,
      return, messaging, and notification refresh.
- [ ] Native validation — stale-cache recovery after server-side lifecycle or policy changes.
- [ ] Native validation — supported OS/device matrix, accessibility, memory pressure, and low-end Android.
- P12 accepted — authoritative HTTP/domain behavior, retry/idempotency foundations, and iOS/Android
  production exports.

## Exit evidence

Record build identifiers, device/OS versions, environment, provider configuration, timestamps,
screenshots/log correlation IDs without secrets, pass/fail/owner, and linked defects. Native acceptance
does not imply production provider certification; provider acceptance requires separate sandbox/live
evidence and operational sign-off.
